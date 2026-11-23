import { AppError } from "../../../shared/errors/app-error.js";
import { logger } from "../../../config/logger.js";
import {
  CHUNK_INDEX_ALIAS,
  VECTOR_FIELD,
} from "./index-manager.service.js";
import { getEmbeddingProvider } from "./embedding.service.js";
import { getSearchClient } from "./es-client.provider.js";
import {
  buildFilterClauses,
  fuseRrf,
  HYBRID_RANK_CONSTANT,
  NUM_CANDIDATES_FACTOR,
  NUM_CANDIDATES_MAX,
} from "./search.service.js";
import type {
  EsHit,
  PassageResultItem,
  PassageSearchResponse,
  SearchDeps,
} from "../types/search.types.js";
import type { SearchQuery } from "../validators/search.validators.js";

/* ------------------------------------------------------------------ */
/* Passage search (M7.3) - hybrid retrieval over the chunk index.      */
/*                                                                     */
/* Same architecture as document-level hybrid: BM25 + kNN fused by    */
/* application-level RRF (reuse of fuseRrf), then collapsed to at most */
/* PASSAGE_MAX_PER_DOC chunks per parent document so one long doc     */
/* cannot crowd out other sources.                                   */
/*                                                                     */
/* Window: fixed (PASSAGE_WINDOW_SIZE) for the same stable-ranking    */
/* reason as hybrid; total = min(unionCount, window).                 */
/* ------------------------------------------------------------------ */

export const PASSAGE_WINDOW_SIZE = 50;
export const MAX_PASSAGE_WINDOW = 1_000;
export const PASSAGE_MAX_PER_DOC = 2;

const CHUNK_SOURCE_FIELDS = [
  "parent_document_id",
  "chunk_index",
  "title",
  "heading",
  "content",
  "url",
  "source",
  "category",
  "contentType",
  "technologies",
  "updatedAt",
];

const CHUNK_HIGHLIGHT_SPEC: Record<string, unknown> = {
  pre_tags: ["<mark>"],
  post_tags: ["</mark>"],
  fields: {
    content: { fragment_size: 200, number_of_fragments: 3 },
    heading: { number_of_fragments: 0 },
  },
};

const buildChunkQuery = (query: SearchQuery): Record<string, unknown> => {
  const bool: Record<string, unknown> = {
    must: [
      {
        multi_match: {
          query: query.q,
          fields: ["title^3", "heading^2", "content^1"],
          type: "best_fields",
        },
      },
    ],
  };
  const filter = buildFilterClauses(query);
  if (filter.length > 0) {
    bool.filter = filter;
  }
  return { bool };
};

const EXCERPT_CHARS = 600;

const toPassageItem = (hit: EsHit): PassageResultItem => {
  const src = (hit._source ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const strArr = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string")
      : [];
  const content = str(src.content);
  return {
    id: str(hit._id),
    documentId: str(src.parent_document_id),
    title: str(src.title),
    url: str(src.url),
    source: str(src.source),
    category: str(src.category) as PassageResultItem["category"],
    contentType: str(src.contentType) as PassageResultItem["contentType"],
    technologies: strArr(src.technologies),
    heading: str(src.heading),
    excerpt:
      content.length > EXCERPT_CHARS
        ? `${content.slice(0, EXCERPT_CHARS)}…`
        : content,
    score: hit._score ?? 0,
    highlights: {
      content: strArr(hit.highlight?.content),
      heading: strArr(hit.highlight?.heading),
    },
  };
};

/**
 * Hybrid retrieval over the chunk index. Requires a query (there is no
 * "browse" for passages) and an embedding provider (the kNN leg is half
 * the point); failures mirror hybrid semantics.
 */
export const passageSearchDocuments = async (
  query: SearchQuery,
  deps: SearchDeps = {}
): Promise<PassageSearchResponse> => {
  const provider =
    deps.embeddingProvider !== undefined
      ? deps.embeddingProvider
      : getEmbeddingProvider();
  if (!provider) {
    throw new AppError(
      "Passage search is not configured on this deployment",
      503,
      "PASSAGE_UNAVAILABLE"
    );
  }

  const client = deps.client ?? (await getSearchClient());
  const window = Math.min(
    deps.searchConfig?.passageWindow ?? PASSAGE_WINDOW_SIZE,
    MAX_PASSAGE_WINDOW
  );
  const maxPerDoc = deps.searchConfig?.passageMaxPerDoc ?? PASSAGE_MAX_PER_DOC;
  const rankConstant = deps.searchConfig?.rankConstant ?? HYBRID_RANK_CONSTANT;
  const filter = buildFilterClauses(query);
  const esQuery = buildChunkQuery(query);

  /* Leg 1: chunk BM25 and the query embedding are independent. */
  const [bm25, embedding] = await Promise.allSettled([
    client.search({
      index: CHUNK_INDEX_ALIAS,
      size: window,
      query: esQuery,
      highlight: CHUNK_HIGHLIGHT_SPEC,
      _source: CHUNK_SOURCE_FIELDS,
    }),
    provider.embedQuery(query.q ?? ""),
  ]);

  if (bm25.status === "rejected") {
    logger.error(
      {
        err:
          bm25.reason instanceof Error ? bm25.reason.message : bm25.reason,
      },
      "Elasticsearch chunk search failed"
    );
    throw new AppError("Search backend unavailable", 503, "SEARCH_UNAVAILABLE");
  }
  if (embedding.status === "rejected") {
    logger.warn(
      {
        err:
          embedding.reason instanceof Error
            ? embedding.reason.message
            : embedding.reason,
      },
      "query embedding failed"
    );
    throw new AppError(
      "Passage search is temporarily unavailable",
      503,
      "PASSAGE_UNAVAILABLE"
    );
  }

  /* Leg 2: chunk kNN + the union count. */
  let knnResponse;
  let unionCount;
  try {
    [knnResponse, unionCount] = await Promise.all([
      client.search({
        index: CHUNK_INDEX_ALIAS,
        size: window,
        knn: {
          field: VECTOR_FIELD,
          query_vector: embedding.value,
          k: window,
          num_candidates: Math.min(
            Math.max(window * NUM_CANDIDATES_FACTOR, 100),
            NUM_CANDIDATES_MAX
          ),
          ...(filter.length > 0 ? { filter } : {}),
        },
        _source: CHUNK_SOURCE_FIELDS,
      }),
      client.count({
        index: CHUNK_INDEX_ALIAS,
        query: {
          bool: {
            filter,
            should: [
              ...((esQuery.bool as { must: unknown[] }).must ?? []),
              { exists: { field: VECTOR_FIELD } },
            ],
            minimum_should_match: 1,
          },
        },
      }),
    ]);
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : error },
      "Elasticsearch passage search failed"
    );
    throw new AppError("Search backend unavailable", 503, "SEARCH_UNAVAILABLE");
  }

  const fused = fuseRrf(
    [bm25.value.hits.hits, knnResponse.hits.hits],
    rankConstant
  );

  /* Parent collapse: at most maxPerDoc chunks per parent document, in
     fused-rank order, so a long doc cannot monopolize the window. */
  const perDoc = new Map<string, number>();
  const collapsed = fused.filter((hit) => {
    const parent = String(
      (hit._source as Record<string, unknown> | undefined)
        ?.parent_document_id ?? ""
    );
    const seen = perDoc.get(parent) ?? 0;
    if (seen >= maxPerDoc) {
      return false;
    }
    perDoc.set(parent, seen + 1);
    return true;
  });

  const from = (query.page - 1) * query.limit;
  const hits = collapsed.slice(from, from + query.limit);
  const total = Math.min(unionCount.count, window);

  return {
    results: hits.map(toPassageItem),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
    },
  };
};
