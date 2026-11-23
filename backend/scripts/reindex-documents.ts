/**
 * In-process document-index reindex: same rebuildSearchIndex path as
 * POST /api/v1/search/reindex, without needing admin HTTP auth. Builds
 * the next index version, embeds only stale documents (existing vectors
 * are reused), then swaps the alias. Safe to re-run - unembedded docs
 * from provider rate limits get reconciled each pass.
 *
 *   npx tsx scripts/reindex-documents.ts
 */
import { connectMongoDB } from "../src/config/database.js";
import { elasticsearchClient } from "../src/config/elasticsearch.js";
import { logger } from "../src/config/logger.js";
import mongoose from "mongoose";
import { rebuildSearchIndex } from "../src/features/search/services/reindex.service.js";

const run = async (): Promise<void> => {
  await connectMongoDB();
  const report = await rebuildSearchIndex({}, (indexed) => {
    logger.info({ indexed }, "reindex progress");
  });
  logger.info(report, "document reindex complete");
};

run()
  .then(async () => {
    await mongoose.disconnect();
    await elasticsearchClient.close();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error({ err: error }, "document reindex failed");
    await mongoose.disconnect().catch(() => undefined);
    await elasticsearchClient.close().catch(() => undefined);
    process.exit(1);
  });
