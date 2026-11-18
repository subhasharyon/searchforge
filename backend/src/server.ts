
import { env } from "./config/env.js";
import { connectMongoDB } from "./config/database.js";
import { connectElasticsearch, elasticsearchClient } from "./config/elasticsearch.js";
import { connectRedis, redisClient } from "./config/redis.js";
import { ensureSearchIndex } from "./features/search/services/index-manager.service.js";
import { logger } from "./config/logger.js";
import mongoose from "mongoose";
import app from "./app.js";
import type { Server } from "node:http";

let server: Server;

const startServer = async (): Promise<void> => {
  try {
    await connectMongoDB();
    await connectElasticsearch();
    await ensureSearchIndex();
    await connectRedis();

    server = app.listen(env.PORT, () => {
      logger.info(`SearchForge API running on port ${env.PORT}`);
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to start SearchForge");
    process.exit(1);
  }
};

const shutdown = async (signal: string): Promise<void> => {
  logger.info(`${signal} received. Shutting down SearchForge...`);

  try {
    if (server) {
      server.closeIdleConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }

    await Promise.allSettled([
      redisClient.quit(),
      elasticsearchClient.close(),
      mongoose.disconnect(),
    ]);

    logger.info("SearchForge shut down successfully");
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, "Error during shutdown");
    process.exit(1);
  }
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

void startServer();
