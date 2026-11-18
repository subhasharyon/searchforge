import { z } from "zod";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CONTENT_TYPES,
} from "../types/document.types.js";

/** Canonical URLs must be absolute http(s). The URL is validated only -
    no fetch ever happens, so there is no SSRF surface. */
const httpUrlSchema = z
  .url()
  .max(2048)
  .refine(
    (value) => /^https?:\/\//i.test(value),
    "URL must use the http or https scheme"
  );

const technologiesSchema = z
  .array(z.string().trim().min(1).max(50))
  .max(100);

/**
 * Strict schemas: unknown keys are rejected rather than stripped, so a
 * client-sent `contentHash` (server-derived) or `source` in an update
 * (immutable identity) fails loudly instead of being silently dropped.
 */
export const createDocumentSchema = z.strictObject({
  title: z.string().trim().min(1).max(300),
  url: httpUrlSchema,
  source: z.string().trim().min(1).max(100),
  category: z.enum(DOCUMENT_CATEGORIES),
  contentType: z.enum(DOCUMENT_CONTENT_TYPES),
  technologies: technologiesSchema.optional(),
  content: z.string().min(1),
  sourceId: z.string().trim().min(1).max(200).optional(),
  author: z.string().trim().min(1).max(200).optional(),
  publishedAt: z.coerce.date().optional(),
});

// Identity fields (source, url) are immutable via the API; everything else
// is optional but at least one field is required.
export const updateDocumentSchema = createDocumentSchema
  .omit({ source: true, url: true })
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field must be provided"
  );

export const lookupQuerySchema = z.object({
  source: z.string().trim().min(1).max(100),
  url: httpUrlSchema,
});

export type CreateDocumentRequest = z.infer<typeof createDocumentSchema>;
export type UpdateDocumentRequest = z.infer<typeof updateDocumentSchema>;
export type LookupQuery = z.infer<typeof lookupQuerySchema>;
