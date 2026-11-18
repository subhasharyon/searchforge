import { Schema, model } from "mongoose";
import {
  CRAWL_RUN_STATUSES,
  type ICrawlRun,
} from "../types/crawler.types.js";

const crawlStatsSchema = new Schema(
  {
    discoveredUrls: { type: Number, default: 0 },
    queuedUrls: { type: Number, default: 0 },
    processedUrls: { type: Number, default: 0 },
    fetchedUrls: { type: Number, default: 0 },
    created: { type: Number, default: 0 },
    updated: { type: Number, default: 0 },
    unchanged: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
  },
  { _id: false }
);

const crawlRunSchema = new Schema<ICrawlRun>(
  {
    sourceId: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 50,
      index: true,
    },
    status: {
      type: String,
      required: true,
      enum: CRAWL_RUN_STATUSES,
      index: true,
    },
    stats: { type: crawlStatsSchema, required: true },
    requestedBy: { type: String, required: true, trim: true },
    stopRequested: { type: Boolean, default: false },
    error: { type: String, maxlength: 1000 },
    startedAt: { type: Date },
    finishedAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.__v;
        return ret;
      },
    },
  }
);

crawlRunSchema.index({ createdAt: -1 });

export const CrawlRunModel = model<ICrawlRun>("CrawlRun", crawlRunSchema);
