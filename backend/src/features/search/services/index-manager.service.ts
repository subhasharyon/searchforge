import { logger } from "../../../config/logger.js";
import { getSearchClient } from "./es-client.provider.js";
import type {
  EsClientLike,
  SearchDeps,
} from "../types/search.types.js";

/**
 * Versioned index strategy: the application always talks to the
 * `SEARCH_INDEX_ALIAS`, which points at exactly one concrete
 * `searchforge-documents-vN` index. Rebuilds create the next version,
 * bulk-fill it, then swap the alias atomically - search never sees a
 * partially populated index and nothing is ever indexed twice.
 */
export const SEARCH_INDEX_ALIAS = "searchforge-documents";
const INDEX_BASE = "searchforge-documents-v";
const INITIAL_VERSION = 1;

/**
 * Mapping rationale:
 *  - dynamic:false       - indexing a stray field can never silently grow
 *                          the mapping (documents still index; the field
 *                          is simply not searchable).
 *  - title/content       - full-text with the english analyzer for
 *                          stemming ("indexes" hits "index"); title also
 *                          gets a keyword sub-field for exact sorting.
 *  - url/source/category/contentType/technologies/contentHash/sourceId
 *                        - keywords: filters, aggregations and dedup.
 *  - dates               - date type for range/sort.
 */
export const SEARCH_MAPPINGS: Record<string, unknown> = {
  dynamic: false,
  properties: {
    title: {
      type: "text",
      analyzer: "english",
      fields: { keyword: { type: "keyword", ignore_above: 256 } },
    },
    content: { type: "text", analyzer: "english" },
    author: {
      type: "text",
      fields: { keyword: { type: "keyword", ignore_above: 256 } },
    },
    url: { type: "keyword" },
    source: { type: "keyword" },
    category: { type: "keyword" },
    contentType: { type: "keyword" },
    technologies: { type: "keyword" },
    contentHash: { type: "keyword" },
    sourceId: { type: "keyword" },
    publishedAt: { type: "date" },
    createdAt: { type: "date" },
    updatedAt: { type: "date" },
  },
};

export const SEARCH_SETTINGS: Record<string, unknown> = {
  number_of_shards: 1,
  number_of_replicas: 0,
};

const indicesOf = (client: EsClientLike) => client.indices;

/** Concrete index names currently pointed at by the alias, if any. */
const aliasTargets = async (
  client: EsClientLike
): Promise<string[]> => {
  try {
    const aliases = await indicesOf(client).getAlias({
      name: SEARCH_INDEX_ALIAS,
    });
    return Object.keys(aliases);
  } catch {
    return [];
  }
};

/** Highest existing `-vN` suffix among alias-backed and stray indices. */
const currentVersion = async (client: EsClientLike): Promise<number> => {
  const targets = await aliasTargets(client);
  const versions = targets
    .map((name) =>
      name.startsWith(INDEX_BASE)
        ? Number.parseInt(name.slice(INDEX_BASE.length), 10)
        : Number.NaN
    )
    .filter((n) => Number.isInteger(n) && n > 0);
  return versions.length > 0 ? Math.max(...versions) : INITIAL_VERSION - 1;
};

/**
 * Idempotent index bootstrap: safe to run on every startup. Creates the
 * v1 index + alias when missing; when the alias already exists it is a
 * no-op (it deliberately does NOT assert mappings - migration belongs to
 * the explicit rebuild flow).
 */
export const ensureSearchIndex = async (
  deps: SearchDeps = {}
): Promise<void> => {
  const client = deps.client ?? (await getSearchClient());

  if (await indicesOf(client).existsAlias({ name: SEARCH_INDEX_ALIAS })) {
    return;
  }

  const initialIndex = `${INDEX_BASE}${INITIAL_VERSION}`;
  if (!(await indicesOf(client).exists({ index: initialIndex }))) {
    await indicesOf(client).create({
      index: initialIndex,
      settings: SEARCH_SETTINGS,
      mappings: SEARCH_MAPPINGS,
    });
    logger.info({ index: initialIndex }, "created search index");
  }

  await indicesOf(client).updateAliases({
    actions: [{ add: { index: initialIndex, alias: SEARCH_INDEX_ALIAS } }],
  });
};

/**
 * Creates the next versioned index (v(current+1)) and returns its name.
 * Caller is responsible for filling it and calling `swapSearchAlias`.
 */
export const createNextIndex = async (
  deps: SearchDeps = {}
): Promise<{ indexName: string; previousTargets: string[] }> => {
  const client = deps.client ?? (await getSearchClient());
  const previousTargets = await aliasTargets(client);
  const indexName = `${INDEX_BASE}${(await currentVersion(client)) + 1}`;

  await indicesOf(client).create({
    index: indexName,
    settings: SEARCH_SETTINGS,
    mappings: SEARCH_MAPPINGS,
  });
  return { indexName, previousTargets };
};

/** Atomically repoints the alias to `indexName`, then drops old indices. */
export const swapSearchAlias = async (
  indexName: string,
  previousTargets: readonly string[],
  deps: SearchDeps = {}
): Promise<void> => {
  const client = deps.client ?? (await getSearchClient());
  const actions: Record<string, unknown>[] = [
    { add: { index: indexName, alias: SEARCH_INDEX_ALIAS } },
    ...previousTargets.map((old) => ({
      remove_index: { index: old },
    })),
  ];
  await indicesOf(client).updateAliases({ actions });
};
