import { lookup as dnsLookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { Agent, type Dispatcher } from "undici";
import {
  FetchError,
  type FetchLike,
  type FetchResponseLike,
  type FetchResult,
  type LookupLike,
} from "../types/crawler.types.js";

/** Identifies the crawler politely; includes a project contact URL. */
export const CRAWLER_USER_AGENT =
  "SearchForge/1.0 (+https://github.com/subhasharyon/searchforge)";

const DEFAULT_TIMEOUT_MS = 10_000;
// Reference documentation pages legitimately run large (node's fs.html
// is ~1.4MB decompressed, redis.io ~7.4MB); 8MB keeps a hard memory bound
// while admitting full-size API references.
const DEFAULT_MAX_BYTES = 8_000_000;
const DEFAULT_MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface FetchOptions {
  /** Exact hostnames allowed to receive requests (SSRF boundary). */
  allowedDomains: readonly string[];
  /** Accepted Content-Type prefixes, e.g. ["text/html"]. */
  allowedContentTypes: readonly string[];
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  signal?: AbortSignal;
  /** Test seams - production always uses the real implementations. */
  fetchImpl?: FetchLike;
  lookup?: LookupLike;
}

const defaultLookup: LookupLike = (hostname) =>
  dnsLookup(hostname, { all: true });

const realFetch: FetchLike = async (url, init) => {
  const response = await fetch(url, {
    method: init?.method ?? "GET",
    headers: init?.headers,
    signal: init?.signal ?? null,
    redirect: "manual",
    // undici extension not present on the DOM RequestInit type.
    dispatcher: init?.dispatcher as Dispatcher | undefined,
  } as RequestInit);
  // Response.body is async-iterable at runtime on Node even where the DOM
  // lib types do not declare it, so adapt the response structurally.
  return response as unknown as FetchResponseLike;
};

/**
 * Only globally-routable unicast addresses are acceptable targets. Everything
 * else - loopback, private, link-local, CGNAT, multicast, reserved,
 * documentation and unspecified ranges - is rejected, including IPv4-mapped
 * IPv6 forms like ::ffff:127.0.0.1.
 */
const isPublicAddress = (address: string): boolean => {
  try {
    let addr: ipaddr.IPv4 | ipaddr.IPv6 = ipaddr.parse(address);
    if (addr instanceof ipaddr.IPv6 && addr.isIPv4MappedAddress()) {
      addr = addr.toIPv4Address();
    }
    return addr.range() === "unicast";
  } catch {
    return false;
  }
};

/**
 * Validates a request target before any network I/O:
 *   - must parse as a URL with http(s) scheme
 *   - hostname must be an exact member of the allowlist (this is the primary
 *     SSRF boundary: a request can never leave approved source domains)
 *   - every resolved IP must be publicly routable, blocking DNS entries that
 *     point an approved-looking name at internal addresses
 */
interface ValidatedTarget {
  url: URL;
  addresses: readonly { address: string; family: number }[];
}

const validateTarget = async (
  rawUrl: string,
  opts: FetchOptions,
  doLookup: LookupLike
): Promise<ValidatedTarget> => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new FetchError("invalid-url", `Malformed URL: ${rawUrl}`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new FetchError("invalid-url", `Unsupported scheme: ${url.protocol}`);
  }

  const host = url.hostname.toLowerCase();
  if (!opts.allowedDomains.includes(host)) {
    throw new FetchError(
      "domain-not-allowed",
      `Host not in source allowlist: ${host}`
    );
  }

  let addresses: readonly { address: string; family: number }[];
  try {
    addresses = await doLookup(host);
  } catch {
    throw new FetchError("dns-failure", `DNS lookup failed: ${host}`, {
      transient: true,
    });
  }
  if (addresses.length === 0) {
    throw new FetchError("dns-failure", `DNS returned no records: ${host}`, {
      transient: true,
    });
  }

  for (const { address } of addresses) {
    if (!isPublicAddress(address)) {
      throw new FetchError(
        "blocked-address",
        `Host ${host} resolves to non-public address`
      );
    }
  }

  return { url, addresses };
};

/**
 * DNS pinning: the connection's resolver is bound to the exact addresses
 * that just passed validation, so the TCP/TLS connect cannot re-resolve the
 * hostname to a different (attacker-flipped) IP between check and connect.
 * This closes the DNS-rebinding TOCTOU window per request hop.
 */
const buildPinnedAgent = (
  addresses: readonly { address: string; family: number }[]
): Agent =>
  new Agent({
    connect: {
      lookup: (
        _hostname: string,
        options: import("node:dns").LookupOptions | undefined,
        callback: (
          err: NodeJS.ErrnoException | null,
          address: string | import("node:dns").LookupAddress[],
          family?: number
        ) => void
      ) => {
        if (options?.all) {
          callback(null, [...addresses]);
          return;
        }
        const first = addresses[0];
        // validateTarget guarantees a non-empty list before this is built.
        callback(null, first?.address ?? "", first?.family);
      },
    },
  });

const readBoundedBody = async (
  body: AsyncIterable<Uint8Array> | null,
  maxBytes: number
): Promise<string> => {
  if (!body) {
    return "";
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      throw new FetchError("too-large", "Response exceeded size limit");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const classifyFetchException = (
  error: unknown,
  combinedSignal: AbortSignal,
  callerSignal?: AbortSignal
): FetchError => {
  if (callerSignal?.aborted) {
    return new FetchError("aborted", "Fetch aborted");
  }
  if (
    error instanceof DOMException &&
    (error.name === "TimeoutError" ||
      combinedSignal.reason instanceof DOMException &&
        combinedSignal.reason.name === "TimeoutError")
  ) {
    return new FetchError("timeout", "Request timed out", { transient: true });
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    // Caller already ruled out - treat as a transient abort-equivalent.
    return new FetchError("timeout", "Request aborted by timeout", {
      transient: true,
    });
  }
  return new FetchError(
    "network",
    `Network error: ${error instanceof Error ? error.message : "unknown"}`,
    { transient: true }
  );
};

/**
 * Controlled GET for approved domains only.
 *
 * Every hop (including each redirect target) goes through full domain + DNS
 * validation, so a redirect can never smuggle a request to an unapproved host
 * or a private address. Responses are bounded by timeout and byte limit and
 * must carry an allowed content type.
 */
export const fetchPage = async (
  url: string,
  opts: FetchOptions
): Promise<FetchResult> => {
  const fetchImpl = opts.fetchImpl ?? realFetch;
  const doLookup = opts.lookup ?? defaultLookup;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  let current = url;
  for (let redirects = 0; ; redirects++) {
    const { url: target, addresses } = await validateTarget(
      current,
      opts,
      doLookup
    );
    // Pinned to the pre-validated addresses for this hop; closed right after
    // headers (close() lets the in-flight body stream finish first).
    const agent = buildPinnedAgent(addresses);

    const signals = [
      AbortSignal.timeout(timeoutMs),
      ...(opts.signal ? [opts.signal] : []),
    ];
    const signal = AbortSignal.any(signals);

    let response;
    try {
      response = await fetchImpl(target.href, {
        method: "GET",
        headers: {
          "user-agent": CRAWLER_USER_AGENT,
          accept: opts.allowedContentTypes.join(", "),
        },
        signal,
        redirect: "manual",
        dispatcher: agent,
      });
    } catch (error) {
      void agent.close();
      throw classifyFetchException(error, signal, opts.signal);
    }
    void agent.close();

    if (REDIRECT_STATUSES.has(response.status)) {
      if (redirects >= maxRedirects) {
        throw new FetchError("redirect-limit", "Too many redirects");
      }
      const location = response.headers.get("location");
      if (!location) {
        throw new FetchError("redirect-invalid", "Redirect without Location");
      }
      let next: URL;
      try {
        next = new URL(location, target);
      } catch {
        throw new FetchError(
          "redirect-invalid",
          `Malformed redirect target: ${location}`
        );
      }
      current = next.href; // fully re-validated on the next loop iteration
      continue;
    }

    if (response.status >= 400) {
      throw new FetchError("http-error", `HTTP ${response.status}`, {
        status: response.status,
        transient: response.status === 429 || response.status >= 500,
      });
    }

    const contentType = (
      (response.headers.get("content-type") ?? "").split(";")[0] ?? ""
    )
      .trim()
      .toLowerCase();
    if (
      !opts.allowedContentTypes.some((allowed) =>
        contentType.startsWith(allowed.toLowerCase())
      )
    ) {
      throw new FetchError(
        "bad-content-type",
        `Unexpected content type: ${contentType || "none"}`,
        { status: response.status }
      );
    }

    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new FetchError("too-large", "Response exceeded size limit");
    }

    const body = await readBoundedBody(response.body, maxBytes);
    return { finalUrl: target.href, status: response.status, contentType, body };
  }
};
