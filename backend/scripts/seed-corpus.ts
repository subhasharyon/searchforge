/**
 * Real-corpus seeder: fetches curated public documentation pages
 * through the SSRF-safe fetcher + markdown extractor and ingests them
 * through the canonical pipeline - which also builds the chunk index.
 *
 *   npm run seed:corpus
 *
 * Quality gates per page: HTTP 200, extractable title, extracted content
 * above MIN_CONTENT_CHARS. Pages are fetched politely (FETCH_DELAY_MS
 * between requests); failures are reported, never silently swallowed.
 */
import { connectMongoDB } from "../src/config/database.js";
import { elasticsearchClient } from "../src/config/elasticsearch.js";
import { logger } from "../src/config/logger.js";
import mongoose from "mongoose";
import { fetchPage } from "../src/features/crawler/services/http-fetcher.service.js";
import { extractContent } from "../src/features/crawler/services/extraction.service.js";
import { ingestDocument } from "../src/features/documents/services/ingestion.service.js";
import {
  ensureChunkIndex,
  ensureSearchIndex,
} from "../src/features/search/services/index-manager.service.js";
import type {
  DocumentCategory,
  DocumentContentType,
} from "../src/features/documents/types/document.types.js";

const MIN_CONTENT_CHARS = 500;
const FETCH_DELAY_MS = 1_500;

interface SeedPage {
  url: string;
  source: string;
  category: DocumentCategory;
  technologies: string[];
}

/**
 * Curated starter corpus: authoritative references real developers
 * search daily. Deliberately page-level (not whole-site crawls) so the
 * corpus stays deterministic and licensing-clean.
 */
const SEED_PAGES: SeedPage[] = [
  {
    url: "https://nodejs.org/api/stream.html",
    source: "nodejs",
    category: "documentation",
    technologies: ["nodejs", "javascript", "streams"],
  },
  {
    url: "https://nodejs.org/api/events.html",
    source: "nodejs",
    category: "documentation",
    technologies: ["nodejs", "javascript", "events"],
  },
  {
    url: "https://nodejs.org/api/fs.html",
    source: "nodejs",
    category: "documentation",
    technologies: ["nodejs", "javascript", "filesystem"],
  },
  {
    url: "https://nodejs.org/api/http.html",
    source: "nodejs",
    category: "documentation",
    technologies: ["nodejs", "javascript", "http"],
  },
  {
    url: "https://docs.docker.com/engine/network/",
    source: "docker",
    category: "documentation",
    technologies: ["docker", "networking", "containers"],
  },
  {
    url: "https://docs.docker.com/engine/storage/",
    source: "docker",
    category: "documentation",
    technologies: ["docker", "storage", "volumes"],
  },
  {
    url: "https://react.dev/reference/react/hooks",
    source: "react",
    category: "documentation",
    technologies: ["react", "javascript", "hooks"],
  },
  {
    url: "https://www.typescriptlang.org/docs/handbook/2/generics.html",
    source: "typescript",
    category: "documentation",
    technologies: ["typescript", "generics"],
  },
  {
    url: "https://www.postgresql.org/docs/current/indexes.html",
    source: "postgresql",
    category: "documentation",
    technologies: ["postgresql", "sql", "indexes"],
  },
  {
    url: "https://kubernetes.io/docs/concepts/services-networking/service/",
    source: "kubernetes",
    category: "documentation",
    technologies: ["kubernetes", "networking", "services"],
  },
  {
    url: "https://redis.io/docs/latest/develop/data-types/streams/",
    source: "redis",
    category: "documentation",
    technologies: ["redis", "streams", "data-structures"],
  },
];

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const seedPage = async (
  page: SeedPage
): Promise<{ outcome: string; detail?: string }> => {
  const host = new URL(page.url).hostname.toLowerCase();
  const fetched = await fetchPage(page.url, {
    allowedDomains: [host],
    allowedContentTypes: ["text/html"],
  });
  if (fetched.status !== 200) {
    return { outcome: "skipped", detail: `HTTP ${fetched.status}` };
  }

  const extracted = extractContent(fetched.body, fetched.finalUrl, [host]);
  if (!extracted.title.trim()) {
    return { outcome: "skipped", detail: "no title" };
  }
  if (extracted.content.trim().length < MIN_CONTENT_CHARS) {
    return {
      outcome: "skipped",
      detail: `thin content (${extracted.content.trim().length} chars)`,
    };
  }

  const result = await ingestDocument({
    title: extracted.title.trim(),
    url: extracted.canonicalUrl ?? fetched.finalUrl,
    source: page.source,
    category: page.category,
    // The extractor emits Markdown (headings + fenced code preserved).
    contentType: "markdown" satisfies DocumentContentType,
    technologies: page.technologies,
    content: extracted.content,
    ...(extracted.author ? { author: extracted.author } : {}),
    ...(extracted.publishedAt ? { publishedAt: extracted.publishedAt } : {}),
  });
  return { outcome: result.outcome };
};

const run = async (): Promise<void> => {
  await connectMongoDB();
  await ensureSearchIndex();
  await ensureChunkIndex();

  const summary: Record<string, number> = {};
  for (const page of SEED_PAGES) {
    try {
      const { outcome, detail } = await seedPage(page);
      summary[outcome] = (summary[outcome] ?? 0) + 1;
      logger.info({ url: page.url, outcome, detail }, "seeded page");
    } catch (error) {
      summary.failed = (summary.failed ?? 0) + 1;
      logger.error(
        {
          url: page.url,
          err: error instanceof Error ? error.message : error,
        },
        "seed page failed"
      );
    }
    await sleep(FETCH_DELAY_MS);
  }

  await elasticsearchClient.indices.refresh({ index: "searchforge-documents" });
  await elasticsearchClient.indices.refresh({ index: "searchforge-chunks" });
  logger.info({ ...summary, total: SEED_PAGES.length }, "corpus seeded");
};

run()
  .then(async () => {
    await mongoose.disconnect();
    await elasticsearchClient.close();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error({ err: error }, "corpus seed failed");
    await mongoose.disconnect().catch(() => undefined);
    await elasticsearchClient.close().catch(() => undefined);
    process.exit(1);
  });
