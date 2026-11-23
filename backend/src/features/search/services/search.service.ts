import { AppError } from "../../../shared/errors/app-error.js";
import { logger } from "../../../config/logger.js";
import { SEARCH_INDEX_ALIAS, VECTOR_FIELD } from "./index-manager.service.js";
import { getEmbeddingProvider } from "./embedding.service.js";
import { getSearchClient } from "./es-client.provider.js";
import type {
  EsHit,
  SearchDeps,
  SearchRankingConfig,
  SearchResponse,
  SearchResultItem,
} from "../types/search.types.js";
import type { SearchQuery } from "../validators/search.validators.js";

/** ES default index.max_result_window - deeper paging is rejected by the
    validator so `from + size` never exceeds this. */
export const MAX_RESULT_WINDOW = 10_000;

/**
 * Lexical relevance strategy (BM25 via match/multi_match):
 *  - multi_match best_fields across title^3 and content - a hit in the
 *    title weighs three times a body hit; "best_fields" scores by the
 *    strongest single field rather than summing noise.
 *  - a `term` should-clause on the technologies keyword field gives an
 *    extra boost to docs tagged with the queried tech.
 *  - filters (category/source/contentType/technology) run in filter
 *    context - they constrain the result set without distorting scores.
 *  - empty `q` degrades to match_all sorted by updatedAt desc, i.e.
 *    "browse latest".
 */

/**
 * Production ranking defaults. Evaluation experiments inject variants
 * through SearchDeps.searchConfig without touching this path.
 */

export const DEFAULT_SEARCH_RANKING: SearchRankingConfig = {
  titleBoost: 3,
  contentBoost: 1,
  technologiesBoost: 2,
};

/**
 * Metadata filters in filter context — shared between BM25 `bool.filter`
 * and semantic `knn.filter` so both modes constrain identically.
 */
export const buildFilterClauses = (
  query: SearchQuery
): Record<string, unknown>[] => {
  const filter: Record<string, unknown>[] = [];
  if (query.category) {
    filter.push({ term: { category: query.category } });
  }
  if (query.source) {
    filter.push({ term: { source: query.source.toLowerCase() } });
  }
  if (query.contentType) {
    filter.push({ term: { contentType: query.contentType } });
  }
  if (query.technology) {
    filter.push({ term: { technologies: query.technology.toLowerCase() } });
  }
  return filter;
};

const buildEsQuery = (
  query: SearchQuery,
  ranking: SearchRankingConfig = DEFAULT_SEARCH_RANKING
): Record<string, unknown> => {
  const must: Record<string, unknown>[] = [];
  const should: Record<string, unknown>[] = [];

  if (query.q) {
    must.push({
      multi_match: {
        query: query.q,
        fields: [`title^${ranking.titleBoost}`, `content^${ranking.contentBoost}`],
        type: "best_fields",
      },
    });
    should.push({
      term: {
        technologies: {
          value: query.q.toLowerCase(),
          boost: ranking.technologiesBoost,
        },
      },
    });
  } else {
    must.push({ match_all: {} });
  }

  const filter = buildFilterClauses(query);

  const bool: Record<string, unknown> = { must };
  if (filter.length > 0) {
    bool.filter = filter;
  }
  if (should.length > 0) {
    bool.should = should;
  }
  return { bool };
};

const HIGHLIGHT_SPEC: Record<string, unknown> = {
  pre_tags: ["<mark>"],
  post_tags: ["</mark>"],
  fields: {
    title: { number_of_fragments: 0 },
    content: { fragment_size: 160, number_of_fragments: 3 },
  },
};

/** Fields the API needs; the vector itself is never returned. */
const SOURCE_FIELDS = [
  "title",
  "url",
  "source",
  "category",
  "contentType",
  "technologies",
  "author",
  "publishedAt",
  "updatedAt",
];

const toResultItem = (hit: EsHit): SearchResultItem => {
  const src = (hit._source ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

  return {
    id: str(hit._id),
    title: str(src.title),
    url: str(src.url),
    source: str(src.source),
    category: str(src.category) as SearchResultItem["category"],
    contentType: str(src.contentType) as SearchResultItem["contentType"],
    technologies: strArr(src.technologies),
    ...(typeof src.author === "string" ? { author: src.author } : {}),
    ...(typeof src.publishedAt === "string"
      ? { publishedAt: src.publishedAt }
      : {}),
    updatedAt: str(src.updatedAt),
    score: typeof hit._score === "number" ? hit._score : 0,
    highlights: {
      title: strArr(hit.highlight?.title),
      content: strArr(hit.highlight?.content),
    },
  };
};

export const searchDocuments = async (
  query: SearchQuery,
  deps: SearchDeps = {}
): Promise<SearchResponse> => {
  const client = deps.client ?? (await getSearchClient());
  const from = (query.page - 1) * query.limit;

  let response;
  try {
    response = await client.search({
      index: SEARCH_INDEX_ALIAS,
      from,
      size: query.limit,
      track_total_hits: true,
      query: buildEsQuery(query, deps.searchConfig),
      // match_all browsing gets a deterministic newest-first order;
      // relevance searches keep _score ordering.
      ...(query.q
        ? {}
        : { sort: [{ updatedAt: { order: "desc" } }] }),
      highlight: HIGHLIGHT_SPEC,
      _source: SOURCE_FIELDS,
    });
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : error },
      "Elasticsearch search failed"
    );
    throw new AppError("Search backend unavailable", 503, "SEARCH_UNAVAILABLE");
  }

  const total =
    typeof response.hits.total === "number"
      ? response.hits.total
      : response.hits.total.value;

  return {
    results: response.hits.hits.map(toResultItem),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
    },
  };
};

/* ------------------------------------------------------------------ */
/* Semantic search                                                      */
/*                                                                     */
/* kNN pagination limitation: Elasticsearch's `knn` retrieval has no   */
/* `from` offset - it always returns the top-k neighbors. We therefore */
/* request k = page*limit and slice the requested page server-side.    */
/* Deep pagination is bounded by MAX_SEMANTIC_K; `total` comes from a  */
/* separate count of vectorized documents matching the same filters,   */
/* which keeps the response envelope honest.                           */
/* ------------------------------------------------------------------ */

export const MAX_SEMANTIC_K = 1_000;
export const NUM_CANDIDATES_FACTOR = 10;
export const NUM_CANDIDATES_MAX = 10_000;

export const semanticSearchDocuments = async (
  query: SearchQuery,
  deps: SearchDeps = {}
): Promise<SearchResponse> => {
  const provider =
    deps.embeddingProvider !== undefined
      ? deps.embeddingProvider
      : getEmbeddingProvider();
  if (!provider) {
    throw new AppError(
      "Semantic search is not configured on this deployment",
      503,
      "SEMANTIC_UNAVAILABLE"
    );
  }

  let queryVector: number[];
  try {
    queryVector = await provider.embedQuery(query.q ?? "");
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : error },
      "query embedding failed"
    );
    throw new AppError(
      "Semantic search is temporarily unavailable",
      503,
      "SEMANTIC_UNAVAILABLE"
    );
  }

  const client = deps.client ?? (await getSearchClient());
  const k = Math.min(query.page * query.limit, MAX_SEMANTIC_K);
  const filter = buildFilterClauses(query);

  let response;
  let vectorCount;
  try {
    [response, vectorCount] = await Promise.all([
      client.search({
        index: SEARCH_INDEX_ALIAS,
        size: k,
        knn: {
          field: VECTOR_FIELD,
          query_vector: queryVector,
          k,
          num_candidates: Math.min(
            Math.max(k * NUM_CANDIDATES_FACTOR, 100),
            NUM_CANDIDATES_MAX
          ),
          ...(filter.length > 0 ? { filter } : {}),
        },
        _source: SOURCE_FIELDS,
      }),
      // Only vectorized docs can ever match kNN; counting them gives the
      // pagination block a truthful total.
      client.count({
        index: SEARCH_INDEX_ALIAS,
        query: {
          bool: {
            filter: [...filter, { exists: { field: VECTOR_FIELD } }],
          },
        },
      }),
    ]);
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : error },
      "Elasticsearch kNN search failed"
    );
    throw new AppError("Search backend unavailable", 503, "SEARCH_UNAVAILABLE");
  }

  const hits = response.hits.hits.slice(
    (query.page - 1) * query.limit,
    query.page * query.limit
  );
  const total = vectorCount.count;

  return {
    results: hits.map(toResultItem),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
    },
  };
};

/* ------------------------------------------------------------------ */
/* Hybrid search - application-level reciprocal rank fusion.            */
/*                                                                     */
/* Native `retriever.rrf` requires an Enterprise license, so fusion    */
/* runs in-process: BM25 and kNN each return a windowed ranked list,   */
/* RRF scores every candidate by 1/(rankConstant + rank) per branch,   */
/* and pages are stable slices of one fused ordering.                  */
/*                                                                     */
/* Window: fixed, not page*limit - a growing window would recompute    */
/* fusion over a larger pool on each page and reorder earlier pages.   */
/* The validator bounds page*limit to HYBRID_WINDOW_SIZE.              */
/*                                                                     */
/* total: min(unionCount, window). unionCount counts the retrievable   */
/* union (BM25 matches OR vectorized docs); min() bounds it to what    */
/* the window can actually serve, mirroring max_result_window.         */
/* ------------------------------------------------------------------ */

export const HYBRID_WINDOW_SIZE = 100;
export const MAX_HYBRID_WINDOW = 1_000;
export const HYBRID_RANK_CONSTANT = 60;

/**
 * Fuse ranked hit lists by reciprocal rank: score(d) = Σ 1/(k + rank).
 * Earlier lists win merge order, so a doc in both BM25 and kNN keeps
 * the BM25 hit (and its highlights). Ties break on _id for a stable,
 * reproducible ordering. The fused score replaces _score.
 */
export const fuseRrf = (
  rankLists: readonly EsHit[][],
  rankConstant: number = HYBRID_RANK_CONSTANT
): EsHit[] => {
  const fused = new Map<string, { score: number; hit: EsHit }>();
  for (const hits of rankLists) {
    hits.forEach((hit, index) => {
      const id = hit._id;
      if (!id) {
        return;
      }
      const contribution = 1 / (rankConstant + index + 1);
      const entry = fused.get(id);
      if (entry) {
        entry.score += contribution;
      } else {
        fused.set(id, { score: contribution, hit });
      }
    });
  }
  return [...fused.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        String(a.hit._id).localeCompare(String(b.hit._id))
    )
    .map((entry) => ({ ...entry.hit, _score: entry.score }));
};

export const hybridSearchDocuments = async (
  query: SearchQuery,
  deps: SearchDeps = {}
): Promise<SearchResponse> => {
  const provider =
    deps.embeddingProvider !== undefined
      ? deps.embeddingProvider
      : getEmbeddingProvider();
  if (!provider) {
    throw new AppError(
      "Hybrid search is not configured on this deployment",
      503,
      "HYBRID_UNAVAILABLE"
    );
  }

  const client = deps.client ?? (await getSearchClient());
  const window = Math.min(
    deps.searchConfig?.hybridWindow ?? HYBRID_WINDOW_SIZE,
    MAX_HYBRID_WINDOW
  );
  const rankConstant =
    deps.searchConfig?.rankConstant ?? HYBRID_RANK_CONSTANT;
  const filter = buildFilterClauses(query);
  const esQuery = buildEsQuery(query, deps.searchConfig);

  /* Leg 1: BM25 and the query embedding are independent - run them
     concurrently. allSettled observes both outcomes so a slow embed
     cannot become an unhandled rejection after a fast ES failure. */
  const [bm25, embedding] = await Promise.allSettled([
    client.search({
      index: SEARCH_INDEX_ALIAS,
      size: window,
      query: esQuery,
      highlight: HIGHLIGHT_SPEC,
      _source: SOURCE_FIELDS,
    }),
    provider.embedQuery(query.q ?? ""),
  ]);

  if (bm25.status === "rejected") {
    logger.error(
      {
        err:
          bm25.reason instanceof Error ? bm25.reason.message : bm25.reason,
      },
      "Elasticsearch search failed"
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
      "Hybrid search is temporarily unavailable",
      503,
      "HYBRID_UNAVAILABLE"
    );
  }

  /* Leg 2: kNN over the fresh vector + the union count are independent. */
  let knnResponse;
  let unionCount;
  try {
    [knnResponse, unionCount] = await Promise.all([
      client.search({
        index: SEARCH_INDEX_ALIAS,
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
        _source: SOURCE_FIELDS,
      }),
      // The retrievable union = docs matching the lexical query OR docs
      // carrying a vector (kNN can surface any vectorized doc). must
      // clauses from esQuery keep the union identical to the BM25 match
      // set; the technologies should-boost never gates.
      client.count({
        index: SEARCH_INDEX_ALIAS,
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
      "Elasticsearch hybrid search failed"
    );
    throw new AppError("Search backend unavailable", 503, "SEARCH_UNAVAILABLE");
  }

  const fused = fuseRrf(
    [bm25.value.hits.hits, knnResponse.hits.hits],
    rankConstant
  );
  const from = (query.page - 1) * query.limit;
  const hits = fused.slice(from, from + query.limit);
  const total = Math.min(unionCount.count, window);

  return {
    results: hits.map(toResultItem),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
    },
  };
};
