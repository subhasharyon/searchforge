import type { HydratedDocument } from "mongoose";
import { CrawlRunModel } from "../models/crawl-run.model.js";
import type { ICrawlRun } from "../types/crawler.types.js";

export type CrawlRunDocument = HydratedDocument<ICrawlRun>;

export const crawlRunRepository = {
  create: (data: {
    sourceId: string;
    requestedBy: string;
    status: ICrawlRun["status"];
    stats: ICrawlRun["stats"];
  }): Promise<CrawlRunDocument> => CrawlRunModel.create(data),

  findById: (id: string): Promise<CrawlRunDocument | null> =>
    CrawlRunModel.findById(id).exec(),

  list: (filter: { sourceId?: string; limit: number }) => {
    const query = filter.sourceId ? { sourceId: filter.sourceId } : {};
    return CrawlRunModel.find(query)
      .sort({ createdAt: -1 })
      .limit(filter.limit)
      .exec();
  },

  update: (
    id: string,
    update: Partial<Pick<ICrawlRun, "status" | "stats" | "error" | "stopRequested" | "startedAt" | "finishedAt">>
  ): Promise<CrawlRunDocument | null> =>
    CrawlRunModel.findByIdAndUpdate(id, update, {
      returnDocument: "after",
    }).exec(),
};
