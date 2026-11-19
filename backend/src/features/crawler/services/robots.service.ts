import robotsParserModule from "robots-parser";
import { logger } from "../../../config/logger.js";
import { fetchPage, type FetchOptions } from "./http-fetcher.service.js";
import { FetchError } from "../types/crawler.types.js";

interface Robot {
  isDisallowed(url: string, ua?: string): boolean | undefined;
  getCrawlDelay(ua?: string): number | undefined;
  getSitemaps(): string[];
}

// robots-parser is CommonJS whose module.exports IS the parser function.
// Under NodeNext the default import yields module.exports at runtime while
// the ambient d.ts models only the `export default` shape - so accept both
// forms (bare function, or a namespace carrying it under `default`).
const robotsParser = ((
  (robotsParserModule as { default?: unknown }).default ??
  robotsParserModule
) as (url: string, contents: string) => Robot);

/** robots directives are evaluated under this product token. */
const ROBOTS_USER_AGENT = "SearchForge";
const ROBOTS_CACHE_TTL_MS = 60 * 60 * 1000;

export interface RobotsPolicy {
  isAllowed: (url: string) => boolean;
  /** Crawl-delay declared by robots.txt in ms (0 when absent). */
  crawlDelayMs: number;
  /** Sitemap URLs declared by robots.txt. */
  sitemaps: string[];
}

const allowAllPolicy: RobotsPolicy = {
  isAllowed: () => true,
  crawlDelayMs: 0,
  sitemaps: [],
};

const disallowAllPolicy: RobotsPolicy = {
  isAllowed: () => false,
  crawlDelayMs: 0,
  sitemaps: [],
};

const cache = new Map<string, { policy: RobotsPolicy; expiresAt: number }>();

export const clearRobotsCache = (): void => {
  cache.clear();
};

export interface RobotsDeps {
  fetchImpl?: FetchOptions["fetchImpl"];
  lookup?: FetchOptions["lookup"];
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Fetches and parses robots.txt for a source origin, with a TTL cache.
 *
 * Failure policy, conservative per RFC 9309 spirit:
 *   - 401/403/404/410          -> no usable robots.txt, allow everything
 *   - 429/5xx/network/timeout  -> assume full disallow (fail closed). A
 *     rate-limited robots fetch must never silently permit crawling.
 */
export const getRobotsPolicy = async (
  baseUrl: string,
  allowedDomains: readonly string[],
  deps: RobotsDeps = {}
): Promise<RobotsPolicy> => {
  const host = new URL(baseUrl).hostname.toLowerCase();
  const cached = cache.get(host);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.policy;
  }

  const robotsUrl = `${new URL(baseUrl).origin}/robots.txt`;
  let policy: RobotsPolicy;
  try {
    const res = await fetchPage(robotsUrl, {
      allowedDomains,
      allowedContentTypes: [
        "text/plain",
        "text/",
        "application/octet-stream",
      ],
      timeoutMs: deps.timeoutMs,
      fetchImpl: deps.fetchImpl,
      lookup: deps.lookup,
      signal: deps.signal,
    });
    const parsed = robotsParser(robotsUrl, res.body);
    policy = {
      isAllowed: (url: string) =>
        parsed.isDisallowed(url, ROBOTS_USER_AGENT) !== true,
      crawlDelayMs: (parsed.getCrawlDelay(ROBOTS_USER_AGENT) ?? 0) * 1000,
      sitemaps: parsed.getSitemaps(),
    };
  } catch (error) {
    const allowAllStatuses = new Set([401, 403, 404, 410]);
    if (
      error instanceof FetchError &&
      error.kind === "http-error" &&
      error.options.status !== undefined &&
      allowAllStatuses.has(error.options.status)
    ) {
      policy = allowAllPolicy;
    } else {
      logger.warn(
        { host, err: error instanceof Error ? error.message : error },
        "robots.txt unavailable; assuming full disallow for this run"
      );
      policy = disallowAllPolicy;
    }
  }

  cache.set(host, { policy, expiresAt: Date.now() + ROBOTS_CACHE_TTL_MS });
  return policy;
};

