import { describe, expect, it, vi } from "vitest";
import {
  FetchError,
  type FetchLike,
  type FetchResponseLike,
  type LookupLike,
} from "../src/features/crawler/types/crawler.types.js";
import { fetchPage } from "../src/features/crawler/services/http-fetcher.service.js";
import {
  clearRobotsCache,
  getRobotsPolicy,
} from "../src/features/crawler/services/robots.service.js";
import {
  discoverUrls,
  isApprovedUrl,
  normalizeUrl,
  parseSitemap,
} from "../src/features/crawler/services/sitemap.service.js";
import { extractContent } from "../src/features/crawler/services/extraction.service.js";
import {
  DomainThrottle,
  runWorkerPool,
  sleep,
} from "../src/features/crawler/services/crawl-queue.service.js";

const ALLOWED = ["docs.example.com"];

const publicLookup: LookupLike = async () => [
  { address: "93.184.216.34", family: 4 },
];

const textBody = (text: string): AsyncIterable<Uint8Array> =>
  (async function* () {
    yield new TextEncoder().encode(text);
  })();

const responseOf = (
  init: Partial<{
    status: number;
    contentType: string;
    location: string;
    body: string;
    contentLength: number;
    chunks: Uint8Array[];
  }> = {}
): FetchResponseLike => ({
  status: init.status ?? 200,
  statusText: "OK",
  headers: {
    get: (name: string) => {
      const key = name.toLowerCase();
      if (key === "content-type") {
        return init.contentType ?? "text/html; charset=utf-8";
      }
      if (key === "location") {
        return init.location ?? null;
      }
      if (key === "content-length") {
        return String(
          init.contentLength ?? (init.body ? init.body.length : 0)
        );
      }
      return null;
    },
  },
  // Getter: a body iterable is single-use; each access must produce a fresh
  // one so routes can be fetched more than once within a test.
  get body() {
    return init.chunks
      ? (async function* () {
          for (const c of init.chunks as Uint8Array[]) {
            yield c;
          }
        })()
      : textBody(init.body ?? "");
  },
});

const fetchWith = (
  routes: Record<string, FetchResponseLike>
): FetchLike => {
  return async (url) => {
    const hit = routes[url];
    if (!hit) {
      throw new Error(`unexpected fetch: ${url}`);
    }
    return hit;
  };
};

const opts = (overrides: Record<string, unknown> = {}) => ({
  allowedDomains: ALLOWED,
  allowedContentTypes: ["text/html"],
  lookup: publicLookup,
  ...overrides,
});

describe("normalizeUrl", () => {
  it("rejects unsupported schemes and malformed URLs", () => {
    expect(normalizeUrl("ftp://example.com/x")).toBeNull();
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
  });

  it("strips fragments, utm params and sorts query params", () => {
    expect(
      normalizeUrl(
        "https://Docs.Example.com/page?b=2&utm_source=feed&a=1#frag"
      )
    ).toBe("https://docs.example.com/page?a=1&b=2");
  });
});

describe("isApprovedUrl", () => {
  it("allows exact allowlist domains only", () => {
    expect(isApprovedUrl("https://docs.example.com/a", ALLOWED)).toBe(true);
    expect(isApprovedUrl("https://evil.com/a", ALLOWED)).toBe(false);
    expect(isApprovedUrl("https://sub.docs.example.com/a", ALLOWED)).toBe(
      false
    );
    expect(isApprovedUrl("ftp://docs.example.com/a", ALLOWED)).toBe(false);
  });
});

describe("parseSitemap", () => {
  it("extracts urls from a urlset", () => {
    const xml = `<?xml version="1.0"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://docs.example.com/a</loc></url>
        <url><loc>https://docs.example.com/b</loc></url>
      </urlset>`;
    const { urls, sitemaps } = parseSitemap(xml);
    expect(urls).toEqual([
      "https://docs.example.com/a",
      "https://docs.example.com/b",
    ]);
    expect(sitemaps).toEqual([]);
  });

  it("extracts child sitemaps from a sitemapindex", () => {
    const xml = `<?xml version="1.0"?>
      <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>https://docs.example.com/sitemap-1.xml</loc></sitemap>
      </sitemapindex>`;
    expect(parseSitemap(xml).sitemaps).toEqual([
      "https://docs.example.com/sitemap-1.xml",
    ]);
  });
});

describe("discoverUrls", () => {
  const robotsAllow = {
    isAllowed: () => true,
    crawlDelayMs: 0,
    sitemaps: [] as string[],
  };

  const source = {
    id: "test",
    name: "Test",
    baseUrl: "https://docs.example.com",
    allowedDomains: [...ALLOWED],
    sitemapUrls: ["https://docs.example.com/sitemap.xml"],
    enabled: true,
    crawlDelayMs: 0,
    maxUrlsPerRun: 10,
    defaultCategory: "documentation" as const,
    technologies: ["test"],
  };

  it("discovers, normalizes, deduplicates and filters urls", async () => {
    const xml = `<urlset>
      <url><loc>https://docs.example.com/a?utm_source=x#f</loc></url>
      <url><loc>https://docs.example.com/a</loc></url>
      <url><loc>https://other.example.com/off-domain</loc></url>
      <url><loc>https://docs.example.com/disallowed</loc></url>
      <url><loc>ftp://docs.example.com/scheme</loc></url>
    </urlset>`;
    const robots = {
      ...robotsAllow,
      isAllowed: (u: string) => !u.includes("disallowed"),
    };
    const fetch = async () => ({ body: xml }) as never;

    const urls = await discoverUrls(source, { fetch, robots });
    expect(urls).toEqual(["https://docs.example.com/a"]);
  });

  it("follows child sitemaps from a sitemap index", async () => {
    const index = `<sitemapindex><sitemap><loc>https://docs.example.com/child.xml</loc></sitemap></sitemapindex>`;
    const child = `<urlset><url><loc>https://docs.example.com/inner</loc></url></urlset>`;
    const routes: Record<string, string> = {
      "https://docs.example.com/sitemap.xml": index,
      "https://docs.example.com/child.xml": child,
    };
    const fetch = async (url: string) => ({ body: routes[url] }) as never;

    const urls = await discoverUrls(source, { fetch, robots: robotsAllow });
    expect(urls).toEqual(["https://docs.example.com/inner"]);
  });

  it("prefers robots-declared sitemaps over configured seeds", async () => {
    const robots = {
      ...robotsAllow,
      sitemaps: ["https://docs.example.com/robots-sitemap.xml"],
    };
    const seen: string[] = [];
    const fetch = async (url: string) => {
      seen.push(url);
      return { body: "<urlset></urlset>" } as never;
    };

    await discoverUrls(source, { fetch, robots });
    expect(seen).toEqual(["https://docs.example.com/robots-sitemap.xml"]);
  });
});

describe("fetchPage", () => {
  const target = "https://docs.example.com/page";

  it("rejects non-http schemes before any network call", async () => {
    const fetchImpl = vi.fn<FetchLike>();
    await expect(
      fetchPage("file:///etc/passwd", opts({ fetchImpl }))
    ).rejects.toMatchObject({ kind: "invalid-url" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects domains outside the allowlist", async () => {
    await expect(
      fetchPage("https://evil.com/x", opts({ fetchImpl: vi.fn() }))
    ).rejects.toMatchObject({ kind: "domain-not-allowed" });
  });

  it("rejects hosts resolving to private addresses", async () => {
    const lookup: LookupLike = async () => [
      { address: "10.0.0.5", family: 4 },
    ];
    await expect(
      fetchPage(target, opts({ fetchImpl: vi.fn(), lookup }))
    ).rejects.toMatchObject({ kind: "blocked-address" });
  });

  it("rejects IPv4-mapped IPv6 loopback", async () => {
    const lookup: LookupLike = async () => [
      { address: "::ffff:127.0.0.1", family: 6 },
    ];
    await expect(
      fetchPage(target, opts({ fetchImpl: vi.fn(), lookup }))
    ).rejects.toMatchObject({ kind: "blocked-address" });
  });

  it("revalidates the domain on every redirect hop", async () => {
    const fetchImpl: FetchLike = async () =>
      responseOf({ status: 301, location: "https://evil.example.com/x" });
    await expect(fetchPage(target, opts({ fetchImpl }))).rejects.toMatchObject(
      { kind: "domain-not-allowed" }
    );
  });

  it("revalidates resolved IPs on redirect targets", async () => {
    // Redirect hops to a second allowlisted name that resolves to a
    // link-local (cloud metadata style) address.
    const lookup: LookupLike = async (host) =>
      host === "mirror.example.com"
        ? [{ address: "169.254.169.254", family: 4 }]
        : [{ address: "93.184.216.34", family: 4 }];
    const fetchImpl: FetchLike = async () =>
      responseOf({
        status: 302,
        location: "https://mirror.example.com/steal",
      });
    await expect(
      fetchPage(target, {
        allowedDomains: ["docs.example.com", "mirror.example.com"],
        allowedContentTypes: ["text/html"],
        lookup,
        fetchImpl,
      })
    ).rejects.toMatchObject({ kind: "blocked-address" });
  });

  it("bounds redirects", async () => {
    const fetchImpl: FetchLike = async () =>
      responseOf({ status: 301, location: target });
    await expect(fetchPage(target, opts({ fetchImpl }))).rejects.toMatchObject(
      { kind: "redirect-limit" }
    );
  });

  it("rejects disallowed content types", async () => {
    const fetchImpl = fetchWith({
      [target]: responseOf({ contentType: "application/pdf" }),
    });
    await expect(fetchPage(target, opts({ fetchImpl }))).rejects.toMatchObject(
      { kind: "bad-content-type" }
    );
  });

  it("rejects oversized responses via content-length", async () => {
    const fetchImpl = fetchWith({
      [target]: responseOf({ contentLength: 999_999_999, body: "x" }),
    });
    await expect(fetchPage(target, opts({ fetchImpl }))).rejects.toMatchObject(
      { kind: "too-large" }
    );
  });

  it("rejects oversized responses discovered while streaming", async () => {
    const big = new Uint8Array(600_000);
    const fetchImpl = fetchWith({
      [target]: responseOf({ chunks: [big, big], contentLength: 100 }),
    });
    await expect(
      fetchPage(target, opts({ fetchImpl, maxBytes: 1_000_000 }))
    ).rejects.toMatchObject({ kind: "too-large" });
  });

  it("marks 404 permanent and 503 transient", async () => {
    await expect(
      fetchPage(target, opts({ fetchImpl: fetchWith({ [target]: responseOf({ status: 404 }) }) }))
    ).rejects.toMatchObject({ kind: "http-error", transient: false });
    await expect(
      fetchPage(target, opts({ fetchImpl: fetchWith({ [target]: responseOf({ status: 503 }) }) }))
    ).rejects.toMatchObject({ kind: "http-error", transient: true });
  });

  it("classifies timeouts as transient", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new DOMException("timed out", "TimeoutError");
    };
    await expect(fetchPage(target, opts({ fetchImpl }))).rejects.toMatchObject(
      { kind: "timeout", transient: true }
    );
  });

  it("passes a DNS-pinned dispatcher to the fetch implementation", async () => {
    let seenDispatcher: unknown;
    const fetchImpl: FetchLike = async (_url, init) => {
      seenDispatcher = init?.dispatcher;
      return responseOf({ body: "ok" });
    };
    await fetchPage(target, opts({ fetchImpl }));
    // The dispatcher pins connect-time DNS to the pre-validated IPs.
    expect(seenDispatcher).toBeDefined();
    expect(
      typeof (seenDispatcher as { dispatch?: unknown }).dispatch
    ).toBe("function");
  });

  it("returns body and final URL on success incl. redirect", async () => {
    const fetchImpl: FetchLike = async (url) =>
      url === target
        ? responseOf({ status: 301, location: "/final" })
        : responseOf({ body: "<p>hello</p>" });
    const res = await fetchPage(target, opts({ fetchImpl }));
    expect(res.body).toBe("<p>hello</p>");
    expect(res.finalUrl).toBe("https://docs.example.com/final");
  });
});

describe("getRobotsPolicy", () => {
  const base = "https://docs.example.com";

  it("parses disallow rules, sitemaps and crawl-delay", async () => {
    clearRobotsCache();
    const robotsTxt = `User-agent: *
Disallow: /private/
Crawl-delay: 5
Sitemap: https://docs.example.com/sitemap.xml`;
    const fetchImpl = fetchWith({
      "https://docs.example.com/robots.txt": responseOf({
        contentType: "text/plain",
        body: robotsTxt,
      }),
    });
    const policy = await getRobotsPolicy(base, ALLOWED, {
      fetchImpl,
      lookup: publicLookup,
    });
    expect(policy.isAllowed("https://docs.example.com/public")).toBe(true);
    expect(policy.isAllowed("https://docs.example.com/private/x")).toBe(false);
    expect(policy.crawlDelayMs).toBe(5000);
    expect(policy.sitemaps).toEqual([
      "https://docs.example.com/sitemap.xml",
    ]);
  });

  it("allows everything when robots.txt is absent (4xx)", async () => {
    clearRobotsCache();
    const fetchImpl = fetchWith({
      "https://docs.example.com/robots.txt": responseOf({ status: 404 }),
    });
    const policy = await getRobotsPolicy(base, ALLOWED, {
      fetchImpl,
      lookup: publicLookup,
    });
    expect(policy.isAllowed("https://docs.example.com/anything")).toBe(true);
  });

  it("fails closed when robots.txt returns 429 (rate limited)", async () => {
    clearRobotsCache();
    const fetchImpl = fetchWith({
      "https://docs.example.com/robots.txt": responseOf({ status: 429 }),
    });
    const policy = await getRobotsPolicy(base, ALLOWED, {
      fetchImpl,
      lookup: publicLookup,
    });
    expect(policy.isAllowed("https://docs.example.com/anything")).toBe(false);
  });

  it("fails closed (disallow all) when robots.txt is unreachable", async () => {
    clearRobotsCache();
    const fetchImpl: FetchLike = async () => {
      throw new FetchError("network", "down", { transient: true });
    };
    const policy = await getRobotsPolicy(base, ALLOWED, {
      fetchImpl,
      lookup: publicLookup,
    });
    expect(policy.isAllowed("https://docs.example.com/anything")).toBe(false);
  });
});

describe("extractContent", () => {
  const page = (inner: string, head = "") =>
    `<!doctype html><html><head>${head}</head><body><nav>nav junk</nav>${inner}<footer>footer junk</footer></body></html>`;
  const url = "https://docs.example.com/page";

  it("extracts title, main content and strips boilerplate", () => {
    const html = page(
      `<main><h1>Streams</h1><p>Read data <em>continuously</em>.</p><ul><li>Readable</li></ul></main>`,
      `<title>Streams Guide</title>`
    );
    const out = extractContent(html, url, ALLOWED);
    expect(out.title).toBe("Streams Guide");
    expect(out.content).toContain("Streams");
    expect(out.content).toContain("continuously");
    expect(out.content).toContain("Readable");
    expect(out.content).not.toContain("nav junk");
    expect(out.content).not.toContain("footer junk");
  });

  it("preserves code block content", () => {
    const html = page(
      `<article><p>Example:</p><pre><code>const x = 1;\n  console.log(x);</code></pre></article>`,
      `<title>T</title>`
    );
    const out = extractContent(html, url, ALLOWED);
    expect(out.content).toContain("const x = 1;");
    expect(out.content).toContain("console.log(x)");
  });

  it("captures canonical url only on approved domains", () => {
    const head = `<link rel="canonical" href="https://docs.example.com/canonical#x">`;
    expect(
      extractContent(page(`<main><p>x</p></main>`, `<title>T</title>${head}`), url, ALLOWED)
        .canonicalUrl
    ).toBe("https://docs.example.com/canonical");

    const offDomain = `<link rel="canonical" href="https://evil.com/steal">`;
    expect(
      extractContent(page(`<main><p>x</p></main>`, `<title>T</title>${offDomain}`), url, ALLOWED)
        .canonicalUrl
    ).toBeUndefined();
  });

  it("captures author and published time from meta", () => {
    const head = `<meta name="author" content="Doc Team"><meta property="article:published_time" content="2024-02-01T00:00:00Z">`;
    const out = extractContent(
      page(`<main><p>x</p></main>`, `<title>T</title>${head}`),
      url,
      ALLOWED
    );
    expect(out.author).toBe("Doc Team");
    expect(out.publishedAt?.toISOString()).toBe("2024-02-01T00:00:00.000Z");
  });

  it("throws when no content is extractable", () => {
    expect(() =>
      extractContent("<html><body><nav>only nav</nav></body></html>", url, ALLOWED)
    ).toThrow();
  });
});

describe("crawl-queue", () => {
  it("bounds concurrency and processes every item", async () => {
    let active = 0;
    let maxActive = 0;
    const done: number[] = [];
    await runWorkerPool(
      Array.from({ length: 10 }, (_, i) => i),
      async (item) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await sleep(5);
        done.push(item);
        active -= 1;
      },
      { concurrency: 3 }
    );
    expect(maxActive).toBeLessThanOrEqual(3);
    expect(done).toHaveLength(10);
  });

  it("stops scheduling when aborted", async () => {
    const controller = new AbortController();
    const done: number[] = [];
    await runWorkerPool(
      [1, 2, 3, 4, 5, 6],
      async (item) => {
        if (item === 2) {
          controller.abort();
        }
        done.push(item);
        await sleep(1);
      },
      { concurrency: 1, signal: controller.signal }
    );
    expect(done).toEqual([1, 2]);
  });

  it("throttles requests to the same domain", async () => {
    const throttle = new DomainThrottle(30);
    const t0 = Date.now();
    await throttle.wait("docs.example.com");
    await throttle.wait("docs.example.com");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25);
  });
});
