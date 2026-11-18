import { z } from "zod";

export const startCrawlSchema = z.strictObject({
  sourceId: z.string().trim().min(1).max(50),
});

export const listRunsQuerySchema = z.object({
  sourceId: z.string().trim().min(1).max(50).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export type StartCrawlRequest = z.infer<typeof startCrawlSchema>;
export type ListRunsQuery = z.infer<typeof listRunsQuerySchema>;
