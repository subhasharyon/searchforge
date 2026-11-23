import { logger } from "../../../config/logger.js";
import { getSearchClient } from "./es-client.provider.js";
import { resolveVectorDims } from "./embedding.service.js";
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

export const VECTOR_FIELD = "content_vector";

/**
 * Base mappings plus the semantic-search fields. The vector field exists
 * only when `vectorDims` is supplied (i.e. a provider is configured) - its
 * `dims` come from the provider contract, never a hard-coded default.
 * `embeddingModel`/`embeddedContentHash` are recorded for staleness and
 * reconciliation queries; the vector itself is never read back.
 */
export const buildSearchMappings = (
  vectorDims?: number
): Record<string, unknown> => {
  if (vectorDims === undefined) {
    return SEARCH_MAPPINGS;
  }
  return {
    ...SEARCH_MAPPINGS,
    properties: {
      ...(SEARCH_MAPPINGS.properties as Record<string, unknown>),
      [VECTOR_FIELD]: {
        type: "dense_vector",
        dims: vectorDims,
        index: true,
        similarity: "cosine",
        index_options: {
          type: "int8_hnsw",
          m: 16,
          ef_construction: 100,
        },
      },
      embeddingModel: { type: "keyword" },
      embeddedContentHash: { type: "keyword" },
    },
  };
};

export const SEARCH_SETTINGS: Record<string, unknown> = {
  number_of_shards: 1,
  number_of_replicas: 0,
};

/* ------------------------------------------------------------------ */
/* Chunk index (M7.3): passage-level retrieval.                        */
/*                                                                     */
/* Chunks are derived data - MongoDB stays canonical for documents    */
/* and the chunk index is a fully rebuildable projection, managed by   */
/* the same versioned-alias machinery as the document index.          */
/* ------------------------------------------------------------------ */

export const CHUNK_INDEX_ALIAS = "searchforge-chunks";
const CHUNK_INDEX_BASE = "searchforge-chunks-v";

/**
 * Chunk mapping rationale:
 *  - parent_document_id  - keyword: exact-match joins to the Mongo _id
 *                          (delete-by-query on doc update/delete).
 *  - chunk_index         - integer position; part of the ES _id.
 *  - title/heading/content - full-text, english analyzer; title also
 *                          keyword for sorting. Heading is indexed text
 *                          so section titles participate in BM25.
 *  - url/source/category/contentType/technologies
 *                        - keywords: same filters as the document index
 *                          so passage retrieval constrains identically.
 *  - content_vector      - same dense_vector profile as documents.
 */
export const CHUNK_MAPPINGS: Record<string, unknown> = {
  dynamic: false,
  properties: {
    parent_document_id: { type: "keyword" },
    chunk_index: { type: "integer" },
    title: {
      type: "text",
      analyzer: "english",
      fields: { keyword: { type: "keyword", ignore_above: 256 } },
    },
    heading: { type: "text", analyzer: "english" },
    content: { type: "text", analyzer: "english" },
    url: { type: "keyword" },
    source: { type: "keyword" },
    category: { type: "keyword" },
    contentType: { type: "keyword" },
    technologies: { type: "keyword" },
    embeddingModel: { type: "keyword" },
    embeddedContentHash: { type: "keyword" },
    updatedAt: { type: "date" },
  },
};

export const buildChunkMappings = (
  vectorDims?: number
): Record<string, unknown> => {
  if (vectorDims === undefined) {
    return CHUNK_MAPPINGS;
  }
  return {
    ...CHUNK_MAPPINGS,
    properties: {
      ...(CHUNK_MAPPINGS.properties as Record<string, unknown>),
      [VECTOR_FIELD]: {
        type: "dense_vector",
        dims: vectorDims,
        index: true,
        similarity: "cosine",
        index_options: {
          type: "int8_hnsw",
          m: 16,
          ef_construction: 100,
        },
      },
    },
  };
};

/** A versioned, aliased index family - one spec per index kind. */
interface IndexSpec {
  alias: string;
  base: string;
  settings: Record<string, unknown>;
  buildMappings: (vectorDims?: number) => Record<string, unknown>;
}

const DOC_INDEX: IndexSpec = {
  alias: SEARCH_INDEX_ALIAS,
  base: INDEX_BASE,
  settings: SEARCH_SETTINGS,
  buildMappings: buildSearchMappings,
};

const CHUNK_INDEX: IndexSpec = {
  alias: CHUNK_INDEX_ALIAS,
  base: CHUNK_INDEX_BASE,
  settings: SEARCH_SETTINGS,
  buildMappings: buildChunkMappings,
};

const indicesOf = (client: EsClientLike) => client.indices;

/** Concrete index names currently pointed at by the alias, if any. */
const aliasTargets = async (
  client: EsClientLike,
  spec: IndexSpec
): Promise<string[]> => {
  try {
    const aliases = await indicesOf(client).getAlias({
      name: spec.alias,
    });
    return Object.keys(aliases);
  } catch {
    return [];
  }
};

/** Highest existing `-vN` suffix among alias-backed and stray indices. */
const currentVersion = async (
  client: EsClientLike,
  spec: IndexSpec
): Promise<number> => {
  const targets = await aliasTargets(client, spec);
  const versions = targets
    .map((name) =>
      name.startsWith(spec.base)
        ? Number.parseInt(name.slice(spec.base.length), 10)
        : Number.NaN
    )
    .filter((n) => Number.isInteger(n) && n > 0);
  return versions.length > 0 ? Math.max(...versions) : INITIAL_VERSION - 1;
};

const ensureIndex = async (
  client: EsClientLike,
  spec: IndexSpec
): Promise<void> => {
  if (await indicesOf(client).existsAlias({ name: spec.alias })) {
    return;
  }

  const initialIndex = `${spec.base}${INITIAL_VERSION}`;
  if (!(await indicesOf(client).exists({ index: initialIndex }))) {
    await indicesOf(client).create({
      index: initialIndex,
      settings: spec.settings,
      mappings: spec.buildMappings(resolveVectorDims()),
    });
    logger.info({ index: initialIndex }, "created search index");
  }

  await indicesOf(client).updateAliases({
    actions: [{ add: { index: initialIndex, alias: spec.alias } }],
  });
};

const createNext = async (
  client: EsClientLike,
  spec: IndexSpec
): Promise<{ indexName: string; previousTargets: string[] }> => {
  const previousTargets = await aliasTargets(client, spec);
  const indexName = `${spec.base}${(await currentVersion(client, spec)) + 1}`;

  await indicesOf(client).create({
    index: indexName,
    settings: spec.settings,
    mappings: spec.buildMappings(resolveVectorDims()),
  });
  return { indexName, previousTargets };
};

const swapAlias = async (
  client: EsClientLike,
  spec: IndexSpec,
  indexName: string,
  previousTargets: readonly string[]
): Promise<void> => {
  const actions: Record<string, unknown>[] = [
    { add: { index: indexName, alias: spec.alias } },
    ...previousTargets.map((old) => ({
      remove_index: { index: old },
    })),
  ];
  await indicesOf(client).updateAliases({ actions });
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
  await ensureIndex(client, DOC_INDEX);
};

/** Same bootstrap for the chunk index family. */
export const ensureChunkIndex = async (
  deps: SearchDeps = {}
): Promise<void> => {
  const client = deps.client ?? (await getSearchClient());
  await ensureIndex(client, CHUNK_INDEX);
};

/**
 * Creates the next versioned index (v(current+1)) and returns its name.
 * Caller is responsible for filling it and calling `swapSearchAlias`.
 */
export const createNextIndex = async (
  deps: SearchDeps = {}
): Promise<{ indexName: string; previousTargets: string[] }> => {
  const client = deps.client ?? (await getSearchClient());
  return createNext(client, DOC_INDEX);
};

/** Chunk-index variant of `createNextIndex`. */
export const createNextChunkIndex = async (
  deps: SearchDeps = {}
): Promise<{ indexName: string; previousTargets: string[] }> => {
  const client = deps.client ?? (await getSearchClient());
  return createNext(client, CHUNK_INDEX);
};

/** Atomically repoints the alias to `indexName`, then drops old indices. */
export const swapSearchAlias = async (
  indexName: string,
  previousTargets: readonly string[],
  deps: SearchDeps = {}
): Promise<void> => {
  const client = deps.client ?? (await getSearchClient());
  await swapAlias(client, DOC_INDEX, indexName, previousTargets);
};

/** Chunk-index variant of `swapSearchAlias`. */
export const swapChunkAlias = async (
  indexName: string,
  previousTargets: readonly string[],
  deps: SearchDeps = {}
): Promise<void> => {
  const client = deps.client ?? (await getSearchClient());
  await swapAlias(client, CHUNK_INDEX, indexName, previousTargets);
};
