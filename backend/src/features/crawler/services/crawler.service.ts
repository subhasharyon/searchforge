import { Types } from "mongoose";
import { logger } from "../../../config/logger.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { ingestDocument } from "../../documents/services/ingestion.service.js";
import { getCrawlSource } from "../config/crawl-sources.js";
import { crawlRunRepository } from "../repositories/crawl-run.repository.js";
import type { CrawlRunDocument } from "../repositories/crawl-run.repository.js";
import {
  emptyCrawlStats,
  FetchError,
  type CrawlSourceConfig,
  type CrawlStats,
  type FetchLike,
  type LookupLike,
} from "../types/crawler.types.js";
import { extractContent } from "./extraction.service.js";
import { fetchPage } from "./http-fetcher.service.js";
import { getRobotsPolicy } from "./robots.service.js";
import { discoverUrls } from "./sitemap.service.js";
import {
  DomainThrottle,
  runWorkerPool,
  sleep,
} from "./crawl-queue.service.js";

const WORKER_CONCURRENCY = 3;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;
const STATS_FLUSH_EVERY = 25;

const CONTENT_TYPES = ["text/html", "application/xhtml+xml"];
const SITEMAP_TYPES = [
  "text/xml",
  "application/xml",
  "text/plain",
  "application/octet-stream",
];

/**
 * Test seam - production never sets these; tests inject a fake fetch and DNS
 * so no live network traffic occurs. Kept module-level so the orchestrator
 * (which is kicked off fire-and-forget by the controller) can share them.
 */
export const crawlerNetworkDeps: {
  fetchImpl?: FetchLike;
  lookup?: LookupLike;
} = {};

interface ActiveRun {
  sourceId: string;
  controller: AbortController;
}

const activeRuns = new Map<string, ActiveRun>();

const fetchPageContent = (url: string, allowedDomains: readonly string[], signal: AbortSignal) =>
  fetchPage(url, {
    allowedDomains,
    allowedContentTypes: CONTENT_TYPES,
    signal,
    fetchImpl: crawlerNetworkDeps.fetchImpl,
    lookup: crawlerNetworkDeps.lookup,
  });

const fetchWithRetry = async (
  url: string,
  allowedDomains: readonly string[],
  signal: AbortSignal
) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchPageContent(url, allowedDomains, signal);
    } catch (error) {
      const retryable = error instanceof FetchError && error.transient;
      if (!retryable || attempt >= MAX_RETRIES || signal.aborted) {
        throw error;
      }
      const backoff = RETRY_BASE_DELAY_MS * 2 ** attempt + Math.random() * 100;
      await sleep(backoff, signal);
    }
  }
};

interface WorkerContext {
  stats: CrawlStats;
  throttle: DomainThrottle;
  source: CrawlSourceConfig;
  signal: AbortSignal;
  onProgress: () => Promise<void>;
}

const processUrl = async (url: string, ctx: WorkerContext): Promise<void> => {
  const { stats, source, signal } = ctx;
  try {
    const host = new URL(url).hostname.toLowerCase();
    await ctx.throttle.wait(host, signal);

    const res = await fetchWithRetry(url, source.allowedDomains, signal);
    stats.fetchedUrls += 1;

    const extracted = extractContent(
      res.body,
      res.finalUrl,
      source.allowedDomains
    );

    const result = await ingestDocument({
      title: extracted.title,
      url: extracted.canonicalUrl ?? res.finalUrl,
      source: source.id,
      category: source.defaultCategory,
      contentType: "markdown",
      technologies: source.technologies,
      content: extracted.content,
      author: extracted.author,
      publishedAt: extracted.publishedAt,
    });

    stats[
      result.outcome === "created"
        ? "created"
        : result.outcome === "updated"
          ? "updated"
          : "unchanged"
    ] += 1;
  } catch (error) {
    if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      stats.skipped += 1;
      return;
    }
    stats.failed += 1;
    logger.warn(
      {
        sourceId: source.id,
        url,
        err:
          error instanceof FetchError
            ? `${error.kind}: ${error.message}`
            : error instanceof Error
              ? error.message
              : error,
      },
      "crawl URL failed"
    );
  } finally {
    stats.processedUrls += 1;
    await ctx.onProgress();
  }
};

const executeCrawl = async (
  runId: string,
  source: CrawlSourceConfig,
  signal: AbortSignal
): Promise<void> => {
  const stats = emptyCrawlStats();
  let processedSinceFlush = 0;
  const flushStats = async (force = false) => {
    processedSinceFlush += 1;
    if (force || processedSinceFlush >= STATS_FLUSH_EVERY) {
      processedSinceFlush = 0;
      await crawlRunRepository.update(runId, { stats });
    }
  };

  try {
    await crawlRunRepository.update(runId, {
      status: "running",
      startedAt: new Date(),
    });

    const robots = await getRobotsPolicy(
      source.baseUrl,
      source.allowedDomains,
      {
        fetchImpl: crawlerNetworkDeps.fetchImpl,
        lookup: crawlerNetworkDeps.lookup,
        signal,
      }
    );

    const discovered = await discoverUrls(source, {
      robots,
      signal,
      fetch: (url, opts) =>
        fetchPage(url, {
          allowedDomains: opts.allowedDomains,
          allowedContentTypes: SITEMAP_TYPES,
          signal,
          fetchImpl: crawlerNetworkDeps.fetchImpl,
          lookup: crawlerNetworkDeps.lookup,
        }),
    });

    stats.discoveredUrls = discovered.length;
    stats.queuedUrls = discovered.length;
    await crawlRunRepository.update(runId, { stats });

    // Per-domain delay is the stricter of the source config and any
    // Crawl-delay declared in robots.txt.
    const throttle = new DomainThrottle(
      Math.max(source.crawlDelayMs, robots.crawlDelayMs)
    );

    await runWorkerPool(
      discovered,
      (url) =>
        processUrl(url, {
          stats,
          throttle,
          source,
          signal,
          onProgress: () => flushStats(false),
        }),
      { concurrency: WORKER_CONCURRENCY, signal }
    );

    await crawlRunRepository.update(runId, {
      status: signal.aborted ? "stopped" : "completed",
      finishedAt: new Date(),
      stats,
    });
  } catch (error) {
    if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      await crawlRunRepository.update(runId, {
        status: "stopped",
        finishedAt: new Date(),
        stats,
      });
      return;
    }
    logger.error(
      { runId, sourceId: source.id, err: error },
      "crawl run failed"
    );
    await crawlRunRepository.update(runId, {
      status: "failed",
      finishedAt: new Date(),
      stats,
      error:
        error instanceof Error ? error.message.slice(0, 500) : "unknown error",
    });
  }
};

const assertValidRunId = (id: string): void => {
  if (!Types.ObjectId.isValid(id)) {
    throw new AppError("Invalid crawl run id", 400, "VALIDATION_ERROR");
  }
};

export const startCrawl = async (
  sourceId: string,
  requestedBy: string
): Promise<CrawlRunDocument> => {
  const source = getCrawlSource(sourceId);
  if (!source) {
    throw new AppError("Unknown crawl source", 404, "CRAWL_SOURCE_NOT_FOUND");
  }
  if (!source.enabled) {
    throw new AppError(
      "Crawl source is disabled",
      400,
      "CRAWL_SOURCE_DISABLED"
    );
  }
  // One active run per source keeps the in-memory queue bounded.
  for (const active of activeRuns.values()) {
    if (active.sourceId === source.id) {
      throw new AppError(
        "A crawl is already running for this source",
        409,
        "CRAWL_ALREADY_RUNNING"
      );
    }
  }

  const run = await crawlRunRepository.create({
    sourceId: source.id,
    requestedBy,
    status: "queued",
    stats: emptyCrawlStats(),
  });

  const runId = run._id.toString();
  const controller = new AbortController();
  activeRuns.set(runId, { sourceId: source.id, controller });
  // Fire-and-forget: the run progresses in-process; errors finalize the run
  // document rather than rejecting back to the HTTP request.
  void executeCrawl(runId, source, controller.signal).finally(() => {
    activeRuns.delete(runId);
  });

  return run;
};

export const stopCrawl = async (id: string): Promise<CrawlRunDocument> => {
  assertValidRunId(id);
  const run = await crawlRunRepository.findById(id);
  if (!run) {
    throw new AppError("Crawl run not found", 404, "CRAWL_RUN_NOT_FOUND");
  }

  const active = activeRuns.get(id);
  if (active) {
    active.controller.abort();
    const updated = await crawlRunRepository.update(id, {
      stopRequested: true,
    });
    return updated ?? run;
  }

  if (run.status === "running" || run.status === "queued") {
    // Stale run (e.g. process restarted): mark it stopped directly.
    const updated = await crawlRunRepository.update(id, {
      status: "stopped",
      stopRequested: true,
      finishedAt: new Date(),
    });
    return updated ?? run;
  }

  throw new AppError(
    "Crawl run is not active",
    409,
    "CRAWL_RUN_NOT_ACTIVE"
  );
};

export const getRun = async (id: string): Promise<CrawlRunDocument> => {
  assertValidRunId(id);
  const run = await crawlRunRepository.findById(id);
  if (!run) {
    throw new AppError("Crawl run not found", 404, "CRAWL_RUN_NOT_FOUND");
  }
  return run;
};

export const listRuns = (
  sourceId?: string,
  limit = 20
): Promise<CrawlRunDocument[]> =>
  crawlRunRepository.list({ sourceId, limit });

