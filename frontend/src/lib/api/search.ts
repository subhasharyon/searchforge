import { authorizedJson } from "@/lib/api/client";
import type { SearchResponse } from "@/types/search";

export interface SearchParams {
  q?: string;
  category?: string;
  source?: string;
  technology?: string;
  contentType?: string;
  page?: number;
  limit?: number;
}

/**
 * Builds the query string for GET /api/v1/search. Only defined parameters
 * are sent — the backend validator rejects unknown keys, so the contract
 * stays narrow on purpose.
 */
export function buildSearchParams({
  q,
  category,
  source,
  technology,
  contentType,
  page,
  limit,
}: SearchParams): string {
  const params = new URLSearchParams();
  const trimmed = q?.trim();
  if (trimmed) {
    params.set("q", trimmed);
  }
  for (const [key, value] of [
    ["category", category],
    ["source", source],
    ["technology", technology],
    ["contentType", contentType],
  ] as const) {
    const v = value?.trim();
    if (v) {
      params.set(key, v);
    }
  }
  if (page !== undefined && page > 1) {
    params.set("page", String(page));
  }
  if (limit !== undefined) {
    params.set("limit", String(limit));
  }
  return params.toString();
}

export async function searchDocuments(
  params: SearchParams
): Promise<SearchResponse> {
  const query = buildSearchParams(params);
  return authorizedJson<SearchResponse>(`/api/v1/search?${query}`);
}
