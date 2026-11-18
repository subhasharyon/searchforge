import type { DocumentCategory } from "../../documents/types/document.types.js";

/**
 * Approved crawl source. Sources are static configuration only - user input
 * can never introduce a new crawl target.
 */
export interface CrawlSourceConfig {
  /** Also used as IDocument.source for ingested documents. */
  id: string;
  name: string;
  baseUrl: string;
  /** Exact hostnames permitted for this source (no wildcards). */
  allowedDomains: string[];
  /** Fallback seed sitemaps when robots.txt lists none. */
  sitemapUrls: string[];
  enabled: boolean;
  /** Minimum delay between requests to the same domain. */
  crawlDelayMs: number;
  /** Caps the in-memory URL queue for one run. */
  maxUrlsPerRun: number;
  defaultCategory: DocumentCategory;
  /** Technology tags applied to every document from this source. */
  technologies: string[];
}

export const CRAWL_RUN_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "stopped",
] as const;
export type CrawlRunStatus = (typeof CRAWL_RUN_STATUSES)[number];

export interface CrawlStats {
  discoveredUrls: number;
  queuedUrls: number;
  processedUrls: number;
  fetchedUrls: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
}

export const emptyCrawlStats = (): CrawlStats => ({
  discoveredUrls: 0,
  queuedUrls: 0,
  processedUrls: 0,
  fetchedUrls: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  skipped: 0,
  failed: 0,
});

export interface ICrawlRun {
  sourceId: string;
  status: CrawlRunStatus;
  stats: CrawlStats;
  /** User id of whoever started the run. */
  requestedBy: string;
  stopRequested: boolean;
  error?: string;
  startedAt?: Date;
  finishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type FetchFailureKind =
  | "invalid-url"
  | "domain-not-allowed"
  | "blocked-address"
  | "dns-failure"
  | "redirect-limit"
  | "redirect-invalid"
  | "timeout"
  | "too-large"
  | "bad-content-type"
  | "http-error"
  | "network"
  | "aborted";

/** Failures are permanent unless flagged transient (retry-worthy). */
export class FetchError extends Error {
  constructor(
    public readonly kind: FetchFailureKind,
    message: string,
    public readonly options: { status?: number; transient?: boolean } = {}
  ) {
    super(message);
    this.name = "FetchError";
  }

  get transient(): boolean {
    return this.options.transient === true;
  }
}

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

export interface FetchResponseLike {
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  body: AsyncIterable<Uint8Array> | null;
}

/** Minimal fetch surface so tests can inject fakes without a live network. */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
    redirect?: string;
    /** undici dispatcher carrying DNS-pinned connect settings. */
    dispatcher?: unknown;
  }
) => Promise<FetchResponseLike>;

/** Minimal DNS lookup surface (matches dns.promises.lookup all:true). */
export type LookupLike = (
  hostname: string
) => Promise<readonly { address: string; family: number }[]>;

export interface FetchResult {
  /** URL after all redirects (validated at every hop). */
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
}

export interface ExtractionResult {
  title: string;
  /** Canonical URL when the page declares one on an approved domain. */
  canonicalUrl?: string;
  content: string;
  author?: string;
  publishedAt?: Date;
}
