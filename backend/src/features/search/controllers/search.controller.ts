import type { Request, Response } from "express";
import { searchDocuments } from "../services/search.service.js";
import { rebuildSearchIndex } from "../services/reindex.service.js";
import type { SearchQuery } from "../validators/search.validators.js";

export const searchController = async (req: Request, res: Response) => {
  // validateQuery has already parsed and stored the query parameters.
  const response = await searchDocuments(req.query as unknown as SearchQuery);

  res.status(200).json({ success: true, data: response });
};

export const reindexController = async (_req: Request, res: Response) => {
  const report = await rebuildSearchIndex();

  res.status(200).json({ success: true, data: { report } });
};
