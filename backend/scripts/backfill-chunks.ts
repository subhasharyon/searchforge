/**
 * One-off chunk backfill for documents that predate M7.3: rebuilds the
 * chunk projection for every Mongo document through the same
 * syncChunksToIndex path ingestion uses. Idempotent - safe to re-run.
 *
 *   npx tsx scripts/backfill-chunks.ts
 */
import { connectMongoDB } from "../src/config/database.js";
import { elasticsearchClient } from "../src/config/elasticsearch.js";
import { logger } from "../src/config/logger.js";
import mongoose from "mongoose";
import { DocumentModel } from "../src/features/documents/models/document.model.js";
import { ensureChunkIndex } from "../src/features/search/services/index-manager.service.js";
import { syncChunksToIndex } from "../src/features/search/services/indexing.service.js";

// Voyage free tier is ~3 RPM - pace the embed batches.
const PACE_MS = Number(process.env.CHUNK_BACKFILL_DELAY_MS ?? 21_000);

/**
 * Documents whose chunks are already fully vectorized don't need work:
 * group chunk docs by parent and collect parents having at least one
 * chunk without content_vector (or no chunks at all).
 */
const parentsMissingVectors = async (): Promise<{
  missing: Set<string>;
  hasChunks: Set<string>;
}> => {
  const agg = await elasticsearchClient.search({
    index: "searchforge-chunks",
    size: 0,
    track_total_hits: false,
    aggs: {
      parents: {
        terms: { field: "parent_document_id", size: 10_000 },
        aggs: {
          // `missing` aggs need doc values, which dense_vector lacks -
          // an exists-filter achieves the same detection.
          unvectorized: {
            filter: {
              bool: { must_not: [{ exists: { field: "content_vector" } }] },
            },
          },
        },
      },
    },
  });
  const missing = new Set<string>();
  const hasChunks = new Set<string>();
  const buckets = (
    agg.aggregations?.parents as
      | { buckets?: { key: string; unvectorized: { doc_count: number } }[] }
      | undefined
  )?.buckets;
  for (const bucket of buckets ?? []) {
    hasChunks.add(bucket.key);
    if (bucket.unvectorized.doc_count > 0) {
      missing.add(bucket.key);
    }
  }
  return { missing, hasChunks };
};

const run = async (): Promise<void> => {
  await connectMongoDB();
  await ensureChunkIndex();

  const { missing, hasChunks } = await parentsMissingVectors();
  const docs = (await DocumentModel.find().sort({ _id: 1 }).exec()).filter(
    (d) => {
      const id = d._id.toString();
      // Either no chunks at all (absent from the agg) or some unvectorized.
      return missing.has(id) || !hasChunks.has(id);
    }
  );
  logger.info(
    { total: docs.length, paceMs: PACE_MS },
    "chunk backfill start"
  );

  let done = 0;
  for (const doc of docs) {
    try {
      await syncChunksToIndex(doc, { embedBatchDelayMs: PACE_MS });
      done += 1;
      logger.info(
        { documentId: doc._id.toString(), title: doc.title, done, total: docs.length },
        "chunks synced"
      );
    } catch (error) {
      logger.error(
        {
          documentId: doc._id.toString(),
          err: error instanceof Error ? error.message : error,
        },
        "chunk sync failed"
      );
    }
    if (done < docs.length) {
      await new Promise((resolve) => setTimeout(resolve, PACE_MS));
    }
  }

  await elasticsearchClient.indices.refresh({ index: "searchforge-chunks" });
  const count = await elasticsearchClient.count({ index: "searchforge-chunks" });
  logger.info({ synced: done, total: docs.length, chunks: count.count }, "chunk backfill complete");
};

run()
  .then(async () => {
    await mongoose.disconnect();
    await elasticsearchClient.close();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error({ err: error }, "chunk backfill failed");
    await mongoose.disconnect().catch(() => undefined);
    await elasticsearchClient.close().catch(() => undefined);
    process.exit(1);
  });
