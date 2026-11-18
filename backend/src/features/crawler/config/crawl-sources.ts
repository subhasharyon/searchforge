import type { CrawlSourceConfig } from "../types/crawler.types.js";

/**
 * Approved source registry. This is static server configuration - there is
 * intentionally no API or env path to add domains, so a request can never
 * turn this service into an arbitrary-domain fetcher.
 *
 * Before flipping `enabled` in a real deployment, confirm each source's
 * robots.txt and rate limits. The crawler additionally honors robots.txt
 * Disallow rules and Crawl-delay at runtime.
 */
export const CRAWL_SOURCES: readonly CrawlSourceConfig[] = [
  {
    id: "mdn",
    name: "MDN Web Docs",
    baseUrl: "https://developer.mozilla.org",
    allowedDomains: ["developer.mozilla.org"],
    sitemapUrls: [
      "https://developer.mozilla.org/sitemaps/en-us/sitemap.xml",
    ],
    enabled: false,
    crawlDelayMs: 1000,
    maxUrlsPerRun: 500,
    defaultCategory: "documentation",
    technologies: ["web", "html", "css", "javascript"],
  },
  {
    id: "nodejs",
    name: "Node.js Documentation",
    baseUrl: "https://nodejs.org",
    allowedDomains: ["nodejs.org"],
    sitemapUrls: ["https://nodejs.org/sitemap.xml"],
    enabled: false,
    crawlDelayMs: 1000,
    maxUrlsPerRun: 500,
    defaultCategory: "documentation",
    technologies: ["nodejs"],
  },
  {
    id: "react",
    name: "React Documentation",
    baseUrl: "https://react.dev",
    allowedDomains: ["react.dev"],
    sitemapUrls: ["https://react.dev/sitemap.xml"],
    enabled: false,
    crawlDelayMs: 1000,
    maxUrlsPerRun: 500,
    defaultCategory: "documentation",
    technologies: ["react"],
  },
  {
    id: "docker",
    name: "Docker Documentation",
    baseUrl: "https://docs.docker.com",
    allowedDomains: ["docs.docker.com"],
    sitemapUrls: ["https://docs.docker.com/sitemap.xml"],
    enabled: false,
    crawlDelayMs: 1000,
    maxUrlsPerRun: 500,
    defaultCategory: "documentation",
    technologies: ["docker"],
  },
  {
    id: "elastic",
    name: "Elastic Documentation",
    baseUrl: "https://www.elastic.co",
    allowedDomains: ["www.elastic.co"],
    sitemapUrls: ["https://www.elastic.co/guide/sitemap.xml"],
    enabled: false,
    crawlDelayMs: 1000,
    maxUrlsPerRun: 500,
    defaultCategory: "documentation",
    technologies: ["elasticsearch"],
  },
];

export const getCrawlSource = (
  id: string
): CrawlSourceConfig | undefined =>
  CRAWL_SOURCES.find((source) => source.id === id);
