import { z } from "zod";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CONTENT_TYPES,
} from "../../documents/types/document.types.js";
import { MAX_RESULT_WINDOW } from "../services/search.service.js";

export const MAX_PAGE_LIMIT = 50;

/**
 * Strict query contract: unknown parameters are rejected, not ignored.
 * `source`/`technology` are free-text (sources grow without schema churn)
 * but normalized to the lowercase storage form. `page*limit` is bounded
 * by the ES result window so deep-pagination requests fail at the edge.
 */
export const searchQuerySchema = z
  .strictObject({
    q: z.string().trim().min(1).max(300).optional(),
    category: z.enum(DOCUMENT_CATEGORIES).optional(),
    source: z.string().trim().min(1).max(100).optional(),
    technology: z.string().trim().min(1).max(50).optional(),
    contentType: z.enum(DOCUMENT_CONTENT_TYPES).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(20),
  })
  .refine(
    (value) => (value.page - 1) * value.limit + value.limit <= MAX_RESULT_WINDOW,
    "Requested page is beyond the searchable result window"
  );

export type SearchQuery = z.infer<typeof searchQuerySchema>;
