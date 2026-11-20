import { Types } from "mongoose";
import { AppError } from "../../../shared/errors/app-error.js";
import { logger } from "../../../config/logger.js";
import { DocumentModel } from "../../documents/models/document.model.js";
import type { DocumentDocument } from "../../documents/repositories/document.repository.js";
import {
  createNextIndex,
  swapSearchAlias,
} from "./index-manager.service.js";
import { getSearchClient } from "./es-client.provider.js";
import { toSearchDocument } from "./indexing.service.js";
import { getEmbeddingProvider } from "./embedding.service.js";
import {
  buildEmbeddingInput,
  embeddingIsStale,
} from "./embedding.provider.js";
import type {
  ReindexReport,
  SearchDeps,
  SearchDocument,
} from "../types/search.types.js";

const REINDEX_BATCH_SIZE = 500;
/** Provider-side input cap per embed call (Voyage's limit is 128). */
const EMBED_BATCH_SIZE = 64;
const MAX_REPORTED_ERRORS = 10;

/**
 * In-process reindex mutex. Two overlapping rebuilds would race on the
 * same `-vN+1` name - and, worse, the loser's cleanup could delete the
 * temp index the winner is filling. Under the single-instance
 * assumption a simple flag is the appropriate guard; it is set
 * synchronously before the first await so it cannot be skipped.
 */
let reindexInProgress = false;

/**
 * Full index rebuild from the canonical MongoDB collection.
 *
 * Strategy (zero-downtime, no duplicates):
 *   1. Create the next versioned index (vN+1) beside the live one.
 *   2. Bulk-index every MongoDB document into it in batches (cursor
 *      streaming - the collection is never fully loaded into memory).
 *   3. Atomically swap the alias to the new index and drop the old one.
 * Search keeps hitting the old index until the very last step, so a
 * failed rebuild leaves the previous index untouched.
 *
 * Failure semantics: ANY bulk-item failure aborts the build. A
 * partially populated index never becomes the active index - the temp
 * index is deleted and the alias stays on the previous target.
 */
export const rebuildSearchIndex = async (
  deps: SearchDeps = {},
  onProgress?: (indexed: number) => void
): Promise<ReindexReport> => {
  if (reindexInProgress) {
    throw new AppError(
      "A reindex operation is already in progress",
      409,
      "REINDEX_IN_PROGRESS"
    );
  }
  reindexInProgress = true;

  try {
    return await doRebuild(deps, onProgress);
  } finally {
    reindexInProgress = false;
  }
};

const doRebuild = async (
  deps: SearchDeps,
  onProgress?: (indexed: number) => void
): Promise<ReindexReport> => {
  const startedAt = Date.now();
  const client = deps.client ?? (await getSearchClient());

  const { indexName, previousTargets } = await createNextIndex({ client });
  const fromIndex = previousTargets[0] ?? null;

  const provider = deps.embeddingProvider !== undefined
    ? deps.embeddingProvider
    : getEmbeddingProvider();

  const report: ReindexReport = {
    fromIndex,
    toIndex: indexName,
    indexed: 0,
    failed: 0,
    batches: 0,
    durationMs: 0,
    errors: [],
    embedded: 0,
    vectorsReused: 0,
    embeddingFailed: 0,
  };

  /**
   * Embeds the stale documents of a batch in provider-sized chunks.
   * Embedding failure is NON-fatal by design: the affected documents are
   * stripped of stale vector state and indexed without vectors, so the
   * keyword rebuild always completes; a re-run reconciles the gaps.
   */
  const embedBatch = async (docs: DocumentDocument[]): Promise<void> => {
    if (!provider || docs.length === 0) {
      report.vectorsReused += docs.filter(
        (d) => d.contentVector?.length
      ).length;
      return;
    }
    const stale = docs.filter((d) => embeddingIsStale(d, provider));
    report.vectorsReused += docs.length - stale.length;
    for (let i = 0; i < stale.length; i += EMBED_BATCH_SIZE) {
      const slice = stale.slice(i, i + EMBED_BATCH_SIZE);
      try {
        const vectors = await provider.embedDocuments(
          slice.map((d) => buildEmbeddingInput(d.title, d.content))
        );
        for (const [j, d] of slice.entries()) {
          d.contentVector = vectors[j];
          d.embeddingModel = provider.model;
          d.embeddedContentHash = d.contentHash;
        }
        await DocumentModel.bulkSave(slice);
        report.embedded += slice.length;
      } catch (error) {
        report.embeddingFailed += slice.length;
        for (const d of slice) {
          d.contentVector = undefined;
          d.embeddingModel = undefined;
          d.embeddedContentHash = undefined;
        }
        await Promise.all(slice.map((d) => d.save())).catch(() => undefined);
        logger.warn(
          {
            err: error instanceof Error ? error.message : error,
            documents: slice.length,
          },
          "embedding batch failed during reindex; docs indexed without vectors"
        );
      }
    }
  };

  try {
    // Sort by _id so the scan is stable; the cursor streams documents.
    const cursor = DocumentModel.find().sort({ _id: 1 }).cursor();

    let docBatch: DocumentDocument[] = [];

    const flush = async (): Promise<void> => {
      if (docBatch.length === 0) {
        return;
      }
      await embedBatch(docBatch);
      const operations: (Record<string, unknown> | SearchDocument)[] = [];
      for (const doc of docBatch) {
        operations.push(
          { index: { _id: (doc._id as Types.ObjectId).toString() } },
          toSearchDocument(doc)
        );
      }
      const bulkResponse = await client.bulk({
        index: indexName,
        operations,
      });
      report.batches += 1;
      if (!bulkResponse.errors) {
        report.indexed += docBatch.length;
      } else {
        // Count every item in this batch accurately, then abort: a
        // partial index must never be promoted to active.
        for (const item of bulkResponse.items) {
          const action = Object.values(item)[0];
          if (action?.error) {
            report.failed += 1;
            if (report.errors.length < MAX_REPORTED_ERRORS) {
              report.errors.push(action.error.reason ?? "unknown error");
            }
          } else {
            report.indexed += 1;
          }
        }
        throw new Error(
          `bulk indexing failed for ${report.failed} document(s)`
        );
      }
      onProgress?.(report.indexed + report.failed);
      docBatch = [];
    };

    for await (const doc of cursor) {
      docBatch.push(doc);
      if (docBatch.length >= REINDEX_BATCH_SIZE) {
        await flush();
      }
    }
    await flush();
  } catch (error) {
    // Drop the half-built index so a retry starts clean; the live index
    // is untouched because the alias never moved.
    await client.indices.delete({ index: indexName }).catch(() => undefined);
    logger.error(
      { err: error, indexName, indexed: report.indexed, failed: report.failed },
      "reindex aborted mid-build"
    );
    throw new AppError(
      "Reindex failed; previous index left intact",
      502,
      "REINDEX_FAILED",
      {
        indexName,
        indexed: report.indexed,
        failed: report.failed,
        errors: report.errors,
      }
    );
  }

  await swapSearchAlias(indexName, previousTargets, { client });

  report.durationMs = Date.now() - startedAt;
  logger.info(
    { ...report },
    "search index rebuild completed"
  );
  return report;
};
