import type { DocumentCategory, DocumentContentType } from "@/types/search"

/**
 * Serialized Mongoose document as returned by
 * GET /api/v1/documents/:id → `{ success: true, data: { document } }`.
 * Mirrors backend/src/features/documents (IDocument + toJSON output).
 */
export interface DocumentDetail {
  _id: string;
  title: string;
  url: string;
  source: string;
  category: DocumentCategory;
  contentType: DocumentContentType;
  technologies: string[];
  /** Extracted plain-text body — untrusted, always render as text. */
  content: string;
  contentHash: string;
  sourceId?: string;
  author?: string;
  /** ISO 8601 */
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}
