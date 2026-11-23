import type { Client } from "@elastic/elasticsearch";
import { env } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";
import type {
  EsBulkResponse,
  EsClientLike,
  EsSearchResponse,
} from "../types/search.types.js";

/**
 * Injectable client seam (same pattern as the crawler's network deps):
 * tests substitute a fake EsClientLike instead of letting calls reach a
 * real Elasticsearch node.
 */
export const searchIndexDeps: { client?: EsClientLike } = {};

/**
 * Under NODE_ENV=test a missing injected client means "no Elasticsearch" -
 * return a no-op so the write-path sync never reaches a developer's live
 * cluster from inside the test suite.
 */
const noopClient: EsClientLike = {
  indices: {
    exists: async () => true,
    create: async () => ({}),
    delete: async () => ({}),
    getAlias: async () => ({}),
    existsAlias: async () => true,
    updateAliases: async () => ({}),
  },
  index: async () => ({}),
  delete: async () => ({}),
  deleteByQuery: async () => ({ deleted: 0 }),
  bulk: async () => ({ errors: false, items: [] }),
  count: async () => ({ count: 0 }),
  search: async (): Promise<EsSearchResponse> => ({
    hits: { total: 0, hits: [] },
  }),
};

let defaultClient: EsClientLike | undefined;

const adaptClient = (client: Client): EsClientLike => ({
  indices: {
    exists: async (opts) => client.indices.exists(opts),
    create: async (opts) => client.indices.create(opts),
    delete: async (opts) => client.indices.delete(opts),
    getAlias: async (opts) =>
      client.indices.getAlias(opts) as Promise<Record<string, unknown>>,
    existsAlias: async (opts) => client.indices.existsAlias(opts),
    updateAliases: async (opts) => client.indices.updateAliases(opts),
  },
  index: async (opts) => client.index(opts),
  delete: async (opts) => client.delete(opts),
  deleteByQuery: async (opts) =>
    client.deleteByQuery(opts) as unknown as Promise<{ deleted?: number }>,
  bulk: async (opts) =>
    client.bulk(opts) as unknown as Promise<EsBulkResponse>,
  count: async (opts) =>
    client.count(opts) as unknown as Promise<{ count: number }>,
  search: async (opts) =>
    client.search(opts as Parameters<Client["search"]>[0]) as unknown as Promise<EsSearchResponse>,
});

let warnedNoop = false;

/**
 * Lazily wraps the shared client from config/elasticsearch. The dynamic
 * import keeps module load safe when ES credentials are not configured.
 */
export const getSearchClient = async (): Promise<EsClientLike> => {
  if (searchIndexDeps.client) {
    return searchIndexDeps.client;
  }
  if (env.NODE_ENV === "test") {
    if (!warnedNoop) {
      warnedNoop = true;
      logger.warn(
        "Elasticsearch calls use a no-op client in tests; inject searchIndexDeps.client"
      );
    }
    return noopClient;
  }
  if (!defaultClient) {
    const { elasticsearchClient } = await import(
      "../../../config/elasticsearch.js"
    );
    defaultClient = adaptClient(elasticsearchClient);
  }
  return defaultClient;
};
