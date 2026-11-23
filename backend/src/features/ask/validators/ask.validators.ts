import { z } from "zod";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CONTENT_TYPES,
} from "../../documents/types/document.types.js";

/**
 * /api/v1/ask contract: a question plus the same metadata filters the
 * search endpoint accepts - retrieval constrains identically to every
 * other mode. Unknown fields are rejected, not ignored.
 */
export const askSchema = z.strictObject({
  question: z.string().trim().min(1).max(500),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  source: z.string().trim().min(1).max(100).optional(),
  technology: z.string().trim().min(1).max(50).optional(),
  contentType: z.enum(DOCUMENT_CONTENT_TYPES).optional(),
});

export type AskBody = z.infer<typeof askSchema>;
