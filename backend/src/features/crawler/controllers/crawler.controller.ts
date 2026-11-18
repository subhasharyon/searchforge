import type { Request, Response } from "express";
import { AppError } from "../../../shared/errors/app-error.js";
import { CRAWL_SOURCES } from "../config/crawl-sources.js";
import {
  getRun,
  listRuns,
  startCrawl,
  stopCrawl,
} from "../services/crawler.service.js";
import type {
  ListRunsQuery,
  StartCrawlRequest,
} from "../validators/crawler.validators.js";

export const listSourcesController = (_req: Request, res: Response) => {
  const sources = CRAWL_SOURCES.map(
    ({ id, name, baseUrl, allowedDomains, enabled }) => ({
      id,
      name,
      baseUrl,
      allowedDomains,
      enabled,
    })
  );

  res.status(200).json({ success: true, data: { sources } });
};

export const startCrawlController = async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError("Unauthenticated", 401, "UNAUTHENTICATED");
  }

  const run = await startCrawl(
    (req.body as StartCrawlRequest).sourceId,
    req.user.id
  );

  res.status(202).json({ success: true, data: { run } });
};

export const listRunsController = async (req: Request, res: Response) => {
  const { sourceId, limit } = req.query as ListRunsQuery;
  const runs = await listRuns(sourceId, limit ?? 20);

  res.status(200).json({ success: true, data: { runs } });
};

export const getRunController = async (req: Request, res: Response) => {
  const run = await getRun(req.params.id as string);

  res.status(200).json({ success: true, data: { run } });
};

export const stopRunController = async (req: Request, res: Response) => {
  const run = await stopCrawl(req.params.id as string);

  res.status(200).json({ success: true, data: { run } });
};
