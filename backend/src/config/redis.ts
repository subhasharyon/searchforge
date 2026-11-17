
import { Redis } from "ioredis";
import { env } from "./env.js";
import { logger } from "./logger.js";

export const redisClient = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
});

export const connectRedis = async (): Promise<void> => {
  try {
    await redisClient.connect();

    await redisClient.ping();

    logger.info("Redis connected successfully");
  } catch (error) {
    logger.error({ err: error }, "Redis connection failed");
    throw error;
  }
};
