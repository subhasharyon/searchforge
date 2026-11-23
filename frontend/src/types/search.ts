/**
 * Search API contract — mirrors the backend response types
 * (backend/src/features/search/types/search.types.ts).
 */

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

/** Retrieval modes supported by GET /api/v1/search. */
export const SEARCH_MODES = ["keyword", "semantic", "hybrid"] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];

/** Single search hit as exposed by the backend API. */
export interface SearchResultItem {
  id: string;
  title: string;
  url: string;
  source: string;
  category: DocumentCategory;
  contentType: DocumentContentType;
  technologies: string[];
  author?: string;
  publishedAt?: string;
  updatedAt: string;
  score: number;
  highlights: {
    title: string[];
    content: string[];
  };
}

export interface SearchPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface SearchResponse {
  results: SearchResultItem[];
  pagination: SearchPagination;
}
