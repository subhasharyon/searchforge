
import mongoose from "mongoose";
import { logger } from "./logger.js";
import { env } from "./env.js";

export const connectMongoDB = async (): Promise<void> => {
  try {
    await mongoose.connect(env.MONGODB_URI);

    logger.info("MongoDB connected successfully");
  } catch (error) {
    logger.error({ err: error }, "MongoDB connection failed");
    throw error;
  }
};
