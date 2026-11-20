import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CONTENT_TYPES,
  SEARCH_MODES,
  type DocumentCategory,
  type DocumentContentType,
  type SearchMode,
} from "@/types/search"

export const DEFAULT_PAGE_SIZE = 10;
/** Mirrors the backend validator's MAX_PAGE_LIMIT. */
export const MAX_PAGE_SIZE = 50;

/**
 * The full search state as represented by the URL. Every field maps to a
 * backend query parameter — no invented params. `page`/`limit` omitted
 * means the defaults (page 1, DEFAULT_PAGE_SIZE).
 */
export interface SearchUrlParams {
  q?: string;
  category?: DocumentCategory;
  source?: string;
  technology?: string;
  contentType?: DocumentContentType;
  page?: number;
  limit?: number;
  /** Absent = keyword (default). Only "semantic" is materialized in URLs. */
  mode?: SearchMode;
}

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? (value[0] ?? "") : (value ?? "")).trim();

const intInRange = (
  value: string,
  min: number,
  max: number
): number | undefined => {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
};

/**
 * Normalizes raw `searchParams` into the search state. Invalid enum values
 * are dropped rather than passed through — a mistyped category can't match
 * anything and would only 400 at the backend.
 */
export function parseSearchParams(
  raw: Record<string, string | string[] | undefined>
): SearchUrlParams {
  const q = first(raw.q);
  const category = first(raw.category);
  const contentType = first(raw.contentType);
  const source = first(raw.source);
  const technology = first(raw.technology);
  const page = intInRange(first(raw.page), 1, Number.MAX_SAFE_INTEGER);
  const limit = intInRange(first(raw.limit), 1, MAX_PAGE_SIZE);
  const mode = first(raw.mode);

  return {
    ...(q ? { q } : {}),
    ...(DOCUMENT_CATEGORIES.includes(category as DocumentCategory)
      ? { category: category as DocumentCategory }
      : {}),
    ...(source ? { source } : {}),
    ...(technology ? { technology } : {}),
    ...(DOCUMENT_CONTENT_TYPES.includes(contentType as DocumentContentType)
      ? { contentType: contentType as DocumentContentType }
      : {}),
    ...(page && page > 1 ? { page } : {}),
    ...(limit ? { limit } : {}),
    ...(SEARCH_MODES.includes(mode as SearchMode) && mode !== "keyword"
      ? { mode: mode as SearchMode }
      : {}),
  };
}

export function buildSearchHref(params: SearchUrlParams): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.category) search.set("category", params.category);
  if (params.source) search.set("source", params.source);
  if (params.technology) search.set("technology", params.technology);
  if (params.contentType) search.set("contentType", params.contentType);
  if (params.page && params.page > 1) search.set("page", String(params.page));
  if (params.limit && params.limit !== DEFAULT_PAGE_SIZE) {
    search.set("limit", String(params.limit));
  }
  if (params.mode && params.mode !== "keyword") {
    search.set("mode", params.mode);
  }
  const qs = search.toString();
  return qs ? `/search?${qs}` : "/search";
}

export function activeFilterCount(params: SearchUrlParams): number {
  return [params.category, params.source, params.technology, params.contentType]
    .filter(Boolean).length;
}
