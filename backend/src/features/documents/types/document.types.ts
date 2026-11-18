/** Canonical document contract for SearchForge content. */

export const DOCUMENT_CATEGORIES = [
  "documentation",
  "article",
  "tutorial",
  "reference",
  "specification",
  "discussion",
  "changelog",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_CONTENT_TYPES = [
  "html",
  "markdown",
  "text",
  "pdf",
] as const;
export type DocumentContentType = (typeof DOCUMENT_CONTENT_TYPES)[number];

export interface IDocument {
  /** Display title of the document. */
  title: string;
  /** Canonical URL, normalized upstream by the ingest pipeline. */
  url: string;
  /** Origin identifier, e.g. "mdn", "stackoverflow", "github". */
  source: string;
  category: DocumentCategory;
  contentType: DocumentContentType;
  /** Lowercase technology tags, e.g. ["nodejs", "mongodb"]. */
  technologies: string[];
  /** Extracted plain-text body used for search and hashing. */
  content: string;
  /** SHA-256 hex digest of the normalized content. Not globally unique -
      different sources may legitimately serve identical content. */
  contentHash: string;
  /** External identifier within the source system, when available. */
  sourceId?: string;
  author?: string;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** Input for creation: technologies is optional (defaults to []). */
export type CreateDocumentInput = Omit<
  IDocument,
  "createdAt" | "updatedAt" | "technologies"
> & { technologies?: string[] };

export type UpdateDocumentInput = Partial<CreateDocumentInput>;

/** Ingestion payload: contentHash is derived server-side, never supplied. */
export type IngestDocumentInput = Omit<CreateDocumentInput, "contentHash">;
