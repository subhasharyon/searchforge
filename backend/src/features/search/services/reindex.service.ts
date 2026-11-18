import { Types } from "mongoose";
import { AppError } from "../../../shared/errors/app-error.js";
import { logger } from "../../../config/logger.js";
import { DocumentModel } from "../../documents/models/document.model.js";
import {
  createNextIndex,
  swapSearchAlias,
} from "./index-manager.service.js";
import { getSearchClient } from "./es-client.provider.js";
import { toSearchDocument } from "./indexing.service.js";
import type {
  ReindexReport,
  SearchDeps,
  SearchDocument,
} from "../types/search.types.js";

const REINDEX_BATCH_SIZE = 500;
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

  const report: ReindexReport = {
    fromIndex,
    toIndex: indexName,
    indexed: 0,
    failed: 0,
    batches: 0,
    durationMs: 0,
    errors: [],
  };

  try {
    // Sort by _id so the scan is stable; the cursor streams documents.
    const cursor = DocumentModel.find().sort({ _id: 1 }).cursor();

    let batch: (Record<string, unknown> | SearchDocument)[] = [];

    const flush = async (): Promise<void> => {
      if (batch.length === 0) {
        return;
      }
      const bulkResponse = await client.bulk({
        index: indexName,
        operations: batch,
      });
      report.batches += 1;
      if (!bulkResponse.errors) {
        report.indexed += batch.length / 2;
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
      batch = [];
    };

    for await (const doc of cursor) {
      batch.push(
        { index: { _id: (doc._id as Types.ObjectId).toString() } },
        toSearchDocument(doc)
      );
      if (batch.length >= REINDEX_BATCH_SIZE * 2) {
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
