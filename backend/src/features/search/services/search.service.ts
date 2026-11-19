import { AppError } from "../../../shared/errors/app-error.js";
import { logger } from "../../../config/logger.js";
import { SEARCH_INDEX_ALIAS } from "./index-manager.service.js";
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

const buildEsQuery = (
  query: SearchQuery,
  ranking: SearchRankingConfig = DEFAULT_SEARCH_RANKING
): Record<string, unknown> => {
  const must: Record<string, unknown>[] = [];
  const should: Record<string, unknown>[] = [];
  const filter: Record<string, unknown>[] = [];

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
      _source: [
        "title",
        "url",
        "source",
        "category",
        "contentType",
        "technologies",
        "author",
        "publishedAt",
        "updatedAt",
      ],
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
