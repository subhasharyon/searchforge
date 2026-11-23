/**
 * Document-vector backfill: re-embeds documents whose stored vector is
 * stale or missing, one doc per provider call, paced for free-tier rate
 * limits (a single batched embed of many large docs trips Voyage's
 * token-per-minute cap even when RPM is under the limit). Safe to re-run;
 * already-current docs are skipped.
 *
 *   npx tsx scripts/backfill-vectors.ts
 */
import { connectMongoDB } from "../src/config/database.js";
import { elasticsearchClient } from "../src/config/elasticsearch.js";
import { logger } from "../src/config/logger.js";
import mongoose from "mongoose";
import { DocumentModel } from "../src/features/documents/models/document.model.js";
import { getEmbeddingProvider } from "../src/features/search/services/embedding.service.js";
import { embeddingIsStale } from "../src/features/search/services/embedding.provider.js";
import {
  ensureDocumentEmbedding,
  indexDocument,
} from "../src/features/search/services/indexing.service.js";

const PACE_MS = Number(process.env.VECTOR_BACKFILL_DELAY_MS ?? 21_000);

const run = async (): Promise<void> => {
  const provider = getEmbeddingProvider();
  if (!provider) {
    throw new Error("EMBEDDING_PROVIDER is disabled - nothing to backfill");
  }
  await connectMongoDB();

  const docs = (await DocumentModel.find().sort({ _id: 1 }).exec()).filter(
    (d) => embeddingIsStale(d, provider)
  );
  logger.info({ stale: docs.length, paceMs: PACE_MS }, "vector backfill start");

  let embedded = 0;
  let failed = 0;
  for (const [i, doc] of docs.entries()) {
    const ok = await ensureDocumentEmbedding(doc);
    if (ok) {
      await indexDocument(doc);
      embedded += 1;
    } else {
      failed += 1;
    }
    logger.info(
      {
        documentId: doc._id.toString(),
        title: doc.title,
        done: i + 1,
        total: docs.length,
        ok,
      },
      "doc processed"
    );
    if (i + 1 < docs.length) {
      await new Promise((resolve) => setTimeout(resolve, PACE_MS));
    }
  }

  logger.info({ embedded, failed, total: docs.length }, "vector backfill complete");
};

run()
  .then(async () => {
    await mongoose.disconnect();
    await elasticsearchClient.close();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error({ err: error }, "vector backfill failed");
    await mongoose.disconnect().catch(() => undefined);
    await elasticsearchClient.close().catch(() => undefined);
    process.exit(1);
  });
