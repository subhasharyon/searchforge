/**
 * Seeds the evaluation corpus through the canonical ingestion pipeline.
 * Idempotent: re-running produces "unchanged" outcomes, not duplicates.
 *
 *   npm run seed:eval
 */
import { connectMongoDB } from "../src/config/database.js";
import { elasticsearchClient } from "../src/config/elasticsearch.js";
import { logger } from "../src/config/logger.js";
import mongoose from "mongoose";
import { ingestDocument } from "../src/features/documents/services/ingestion.service.js";
import { ensureSearchIndex } from "../src/features/search/services/index-manager.service.js";
import { EVAL_CORPUS } from "../src/features/evaluation/dataset/eval-corpus.js";

const run = async (): Promise<void> => {
  await connectMongoDB();
  await ensureSearchIndex();

  const outcomes = { created: 0, updated: 0, unchanged: 0 };
  for (const doc of EVAL_CORPUS) {
    const result = await ingestDocument(doc);
    outcomes[result.outcome] += 1;
    logger.info({ url: doc.url, outcome: result.outcome }, "seeded");
  }

  // Make freshly indexed documents searchable immediately.
  await elasticsearchClient.indices.refresh({
    index: "searchforge-documents",
  });

  logger.info(
    { total: EVAL_CORPUS.length, ...outcomes },
    "evaluation corpus seeded"
  );
};

run()
  .then(async () => {
    await mongoose.disconnect();
    await elasticsearchClient.close();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error({ err: error }, "seed failed");
    await mongoose.disconnect().catch(() => undefined);
    await elasticsearchClient.close().catch(() => undefined);
    process.exit(1);
  });
