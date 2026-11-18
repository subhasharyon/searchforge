import * as cheerio from "cheerio";
import { logger } from "../../../config/logger.js";
import type { CrawlSourceConfig } from "../types/crawler.types.js";
import type { FetchResult } from "../types/crawler.types.js";
import type { RobotsPolicy } from "./robots.service.js";

const MAX_SITEMAP_FILES = 20;

/**
 * Normalizes a URL for identity/dedup: lowercases host, removes fragments,
 * strips utm_* tracking params, sorts remaining query params. Returns null
 * for URLs that cannot be crawled (bad syntax or non-http(s) scheme).
 */
export const normalizeUrl = (raw: string): string | null => {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    url.hash = "";
    // keys() is a live view; snapshot before deleting so nothing is skipped.
    for (const key of Array.from(url.searchParams.keys())) {
      if (key.toLowerCase().startsWith("utm_")) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.href;
  } catch {
    return null;
  }
};

export const isApprovedUrl = (
  raw: string,
  allowedDomains: readonly string[]
): boolean => {
  const normalized = normalizeUrl(raw);
  if (!normalized) {
    return false;
  }
  return allowedDomains.includes(new URL(normalized).hostname.toLowerCase());
};

interface ParsedSitemap {
  urls: string[];
  sitemaps: string[];
}

/** Parses sitemap XML into child sitemap URLs and page URLs. */
export const parseSitemap = (xml: string): ParsedSitemap => {
  const $ = cheerio.load(xml, { xml: true });
  const urls: string[] = [];
  const sitemaps: string[] = [];

  // Local-name matching tolerates namespace-prefixed elements (e.g. ns:url).
  $("loc").each((_, el) => {
    const parentTag = ($(el).parent().prop("tagName") ?? "")
      .split(":")
      .pop()
      ?.toLowerCase();
    const loc = $(el).text().trim();
    if (!loc) {
      return;
    }
    if (parentTag === "url") {
      urls.push(loc);
    } else if (parentTag === "sitemap") {
      sitemaps.push(loc);
    }
  });

  return { urls, sitemaps };
};

export interface DiscoveryDeps {
  fetch: (
    url: string,
    opts: { allowedDomains: readonly string[] }
  ) => Promise<FetchResult>;
  robots: RobotsPolicy;
  signal?: AbortSignal;
}

/**
 * Sitemap-driven discovery. Seed sitemaps come from robots.txt when declared,
 * otherwise from the source config. Child sitemaps are followed (bounded by
 * MAX_SITEMAP_FILES). Every candidate is normalized, domain-checked,
 * deduplicated and filtered by robots Disallow rules before queuing.
 */
export const discoverUrls = async (
  source: CrawlSourceConfig,
  deps: DiscoveryDeps
): Promise<string[]> => {
  const approved = source.allowedDomains;
  const seeds = (
    deps.robots.sitemaps.length > 0
      ? deps.robots.sitemaps
      : source.sitemapUrls
  ).filter((url) => isApprovedUrl(url, approved));

  const discovered = new Set<string>();
  const sitemapQueue = [...seeds];
  let sitemapsFetched = 0;

  while (
    sitemapQueue.length > 0 &&
    sitemapsFetched < MAX_SITEMAP_FILES &&
    discovered.size < source.maxUrlsPerRun &&
    !deps.signal?.aborted
  ) {
    const sitemapUrl = sitemapQueue.shift() as string;
    sitemapsFetched++;

    let res: FetchResult;
    try {
      res = await deps.fetch(sitemapUrl, { allowedDomains: approved });
    } catch (error) {
      logger.warn(
        {
          sourceId: source.id,
          sitemapUrl,
          err: error instanceof Error ? error.message : error,
        },
        "sitemap fetch failed; skipping"
      );
      continue;
    }

    const { urls, sitemaps } = parseSitemap(res.body);
    for (const url of urls) {
      const normalized = normalizeUrl(url);
      if (
        normalized &&
        approved.includes(new URL(normalized).hostname.toLowerCase()) &&
        deps.robots.isAllowed(normalized)
      ) {
        discovered.add(normalized);
        if (discovered.size >= source.maxUrlsPerRun) {
          break;
        }
      }
    }
    for (const child of sitemaps) {
      if (isApprovedUrl(child, approved)) {
        sitemapQueue.push(child);
      }
    }
  }

  return [...discovered];
};
