import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DocumentModel } from "../src/features/documents/models/document.model.js";
import { documentRepository } from "../src/features/documents/repositories/document.repository.js";
import {
  createNextIndex,
  ensureSearchIndex,
  SEARCH_INDEX_ALIAS,
  SEARCH_MAPPINGS,
  swapSearchAlias,
} from "../src/features/search/services/index-manager.service.js";
import {
  indexDocument,
  removeDocument,
  toSearchDocument,
} from "../src/features/search/services/indexing.service.js";
import { rebuildSearchIndex } from "../src/features/search/services/reindex.service.js";
import { searchDocuments } from "../src/features/search/services/search.service.js";
import type {
  EsClientLike,
  EsHit,
  EsSearchResponse,
  SearchDocument,
} from "../src/features/search/types/search.types.js";
import type { SearchQuery } from "../src/features/search/validators/search.validators.js";
import { AppError } from "../src/shared/errors/app-error.js";
import { startTestDb, stopTestDb } from "./helpers/test-db.js";

/* ------------------------------------------------------------------ */
/* Fake Elasticsearch client                                            */
/* ------------------------------------------------------------------ */

interface FakeState {
  indices: Set<string>;
  aliases: Map<string, string>;
}

const esNotFound = (): Error & { statusCode: number } =>
  Object.assign(new Error("not found"), { statusCode: 404 });

const fakeClient = (
  opts: { searchResponse?: EsSearchResponse } = {}
): {
  client: EsClientLike;
  state: FakeState;
  calls: { method: string; arg: unknown }[];
} => {
  const state: FakeState = { indices: new Set(), aliases: new Map() };
  const calls: { method: string; arg: unknown }[] = [];

  const client: EsClientLike = {
    indices: {
      exists: async (arg) => {
        calls.push({ method: "indices.exists", arg });
        return state.indices.has(arg.index);
      },
      create: async (arg) => {
        calls.push({ method: "indices.create", arg });
        state.indices.add(arg.index);
        return {};
      },
      delete: async (arg) => {
        calls.push({ method: "indices.delete", arg });
        state.indices.delete(arg.index);
        return {};
      },
      getAlias: async (arg) => {
        calls.push({ method: "indices.getAlias", arg });
        const target = state.aliases.get(arg.name);
        if (!target) {
          throw esNotFound();
        }
        return { [target]: { aliases: { [arg.name]: {} } } };
      },
      existsAlias: async (arg) => {
        calls.push({ method: "indices.existsAlias", arg });
        return state.aliases.has(arg.name);
      },
      updateAliases: async (arg) => {
        calls.push({ method: "indices.updateAliases", arg });
        for (const action of arg.actions) {
          const add = action.add as { index: string; alias: string } | undefined;
          const removeIndex = action.remove_index as
            | { index: string }
            | undefined;
          if (add) {
            state.aliases.set(add.alias, add.index);
            state.indices.add(add.index);
          }
          if (removeIndex) {
            state.indices.delete(removeIndex.index);
            if (state.aliases.get(SEARCH_INDEX_ALIAS) === removeIndex.index) {
              state.aliases.delete(SEARCH_INDEX_ALIAS);
            }
          }
        }
        return {};
      },
    },
    index: async (arg) => {
      calls.push({ method: "index", arg });
      return {};
    },
    delete: async (arg) => {
      calls.push({ method: "delete", arg });
      return {};
    },
    bulk: async (arg) => {
      calls.push({ method: "bulk", arg });
      const items = arg.operations
        .filter((_, i) => i % 2 === 0)
        .map(() => ({ index: { status: 200 } }));
      return { errors: false, items };
    },
    search: async (arg) => {
      calls.push({ method: "search", arg });
      return (
        opts.searchResponse ?? { hits: { total: { value: 0 }, hits: [] } }
      );
    },
  };

  return { client, state, calls };
};

const lastCall = (
  calls: { method: string; arg: unknown }[],
  method: string
): { method: string; arg: unknown } | undefined =>
  [...calls].reverse().find((c) => c.method === method);

beforeAll(startTestDb);
afterAll(stopTestDb);

const query = (overrides: Partial<SearchQuery> = {}): SearchQuery => ({
  page: 1,
  limit: 20,
  ...overrides,
});

/* ------------------------------------------------------------------ */
/* Index management                                                     */
/* ------------------------------------------------------------------ */

describe("ensureSearchIndex", () => {
  it("creates the v1 index and alias when nothing exists", async () => {
    const { client, state, calls } = fakeClient();

    await ensureSearchIndex({ client });

    const create = lastCall(calls, "indices.create")?.arg as {
      index: string;
      mappings: unknown;
    };
    expect(create.index).toBe("searchforge-documents-v1");
    expect(create.mappings).toEqual(SEARCH_MAPPINGS);
    expect(state.aliases.get(SEARCH_INDEX_ALIAS)).toBe(
      "searchforge-documents-v1"
    );
  });

  it("is a no-op when the alias already exists", async () => {
    const { client, state, calls } = fakeClient();
    state.indices.add("searchforge-documents-v1");
    state.aliases.set(SEARCH_INDEX_ALIAS, "searchforge-documents-v1");

    await ensureSearchIndex({ client });

    expect(calls.some((c) => c.method === "indices.create")).toBe(false);
    expect(state.aliases.get(SEARCH_INDEX_ALIAS)).toBe(
      "searchforge-documents-v1"
    );
  });

  it("is safe to run repeatedly", async () => {
    const { client, state } = fakeClient();
    await ensureSearchIndex({ client });
    await ensureSearchIndex({ client });
    expect(state.aliases.get(SEARCH_INDEX_ALIAS)).toBe(
      "searchforge-documents-v1"
    );
  });
});

describe("createNextIndex / swapSearchAlias", () => {
  it("creates v2 alongside v1 and swaps the alias atomically", async () => {
    const { client, state, calls } = fakeClient();
    state.indices.add("searchforge-documents-v1");
    state.aliases.set(SEARCH_INDEX_ALIAS, "searchforge-documents-v1");

    const { indexName, previousTargets } = await createNextIndex({ client });
    expect(indexName).toBe("searchforge-documents-v2");
    expect(previousTargets).toEqual(["searchforge-documents-v1"]);

    await swapSearchAlias(indexName, previousTargets, { client });

    const swap = lastCall(calls, "indices.updateAliases")?.arg as {
      actions: Record<string, unknown>[];
    };
    // Atomic swap: alias added to v2 and v1 removed in one request.
    expect(swap.actions).toEqual([
      { add: { index: "searchforge-documents-v2", alias: SEARCH_INDEX_ALIAS } },
      { remove_index: { index: "searchforge-documents-v1" } },
    ]);
    expect(state.aliases.get(SEARCH_INDEX_ALIAS)).toBe(
      "searchforge-documents-v2"
    );
    expect(state.indices.has("searchforge-documents-v1")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Indexing                                                             */
/* ------------------------------------------------------------------ */

let seedCounter = 0;
const seedDoc = async () =>
  documentRepository.create({
    title: "Node.js Streams",
    url: `https://nodejs.org/api/stream-${++seedCounter}.html`,
    source: "nodejs",
    category: "documentation",
    contentType: "html",
    technologies: ["nodejs"],
    content: "Streams are collections of data.",
    contentHash: "a".repeat(64),
  });

describe("toSearchDocument", () => {

  it("maps a Mongo document to the flat index shape", async () => {
    const doc = await seedDoc();
    const mapped = toSearchDocument(doc);

    expect(mapped.title).toBe("Node.js Streams");
    expect(mapped.content).toBe("Streams are collections of data.");
    expect(mapped.createdAt).toBe(doc.createdAt.toISOString());
    expect(mapped).not.toHaveProperty("publishedAt");
    expect(mapped).not.toHaveProperty("author");
    expect(mapped).not.toHaveProperty("_id");
    expect(mapped).not.toHaveProperty("__v");
  });
});

describe("indexDocument / removeDocument", () => {

  it("indexes under the Mongo _id through the alias", async () => {
    const { client, calls } = fakeClient();
    const doc = await seedDoc();

    await indexDocument(doc, { client });

    const call = lastCall(calls, "index")?.arg as {
      index: string;
      id: string;
      document: SearchDocument;
    };
    expect(call.index).toBe(SEARCH_INDEX_ALIAS);
    expect(call.id).toBe(doc._id.toString());
    expect(call.document.title).toBe("Node.js Streams");
  });

  it("deletes by id and treats 404 as already-gone", async () => {
    const { client, calls } = fakeClient();
    client.delete = async () => {
      throw esNotFound();
    };
    await expect(removeDocument("someid", { client })).resolves.toBeUndefined();

    client.delete = async () => {
      throw Object.assign(new Error("boom"), { statusCode: 500 });
    };
    await expect(removeDocument("someid", { client })).rejects.toThrow("boom");

    const realClient = fakeClient();
    await removeDocument("x", { client: realClient.client });
    expect(lastCall(realClient.calls, "delete")?.arg).toEqual({
      index: SEARCH_INDEX_ALIAS,
      id: "x",
    });
    void calls;
  });
});

/* ------------------------------------------------------------------ */
/* Reindex                                                              */
/* ------------------------------------------------------------------ */

describe("rebuildSearchIndex", () => {

  it("rebuilds into a new index, bulks all docs, swaps alias, drops old", async () => {
    await DocumentModel.deleteMany({});
    await seedDoc();
    await seedDoc();

    const { client, state, calls } = fakeClient();
    state.indices.add("searchforge-documents-v1");
    state.aliases.set(SEARCH_INDEX_ALIAS, "searchforge-documents-v1");

    const report = await rebuildSearchIndex({ client });

    expect(report.toIndex).toBe("searchforge-documents-v2");
    expect(report.fromIndex).toBe("searchforge-documents-v1");
    expect(report.indexed).toBe(2);
    expect(report.failed).toBe(0);
    // bulk targeted the concrete new index, not the alias.
    const bulk = lastCall(calls, "bulk")?.arg as { index: string };
    expect(bulk.index).toBe("searchforge-documents-v2");
    expect(state.aliases.get(SEARCH_INDEX_ALIAS)).toBe(
      "searchforge-documents-v2"
    );
    expect(state.indices.has("searchforge-documents-v1")).toBe(false);
  });

  it("aborts on bulk-item failures, keeps the old index active, cleans up", async () => {
    await DocumentModel.deleteMany({});
    await seedDoc();
    await seedDoc();

    const { client, state, calls } = fakeClient();
    state.indices.add("searchforge-documents-v1");
    state.aliases.set(SEARCH_INDEX_ALIAS, "searchforge-documents-v1");
    client.bulk = async () => ({
      errors: true,
      items: [
        { index: { status: 200 } },
        { index: { status: 400, error: { reason: "mapper_parsing" } } },
      ],
    });

    const error = await rebuildSearchIndex({ client }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    const appError = error as AppError;
    expect(appError.code).toBe("REINDEX_FAILED");
    // Accurate counts for processed items surface in the error details.
    expect(appError.details).toMatchObject({
      indexName: "searchforge-documents-v2",
      indexed: 1,
      failed: 1,
      errors: ["mapper_parsing"],
    });
    // The previously active index is untouched; the temp index is gone.
    expect(state.aliases.get(SEARCH_INDEX_ALIAS)).toBe(
      "searchforge-documents-v1"
    );
    expect(state.indices.has("searchforge-documents-v2")).toBe(false);
    expect(calls.some((c) => c.method === "indices.updateAliases")).toBe(
      false
    );
  });

  it("rejects a concurrent rebuild while one is in progress", async () => {
    await DocumentModel.deleteMany({});
    await seedDoc();

    const { client } = fakeClient();
    let releaseBulk: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseBulk = resolve;
    });
    client.bulk = async () => {
      await gate;
      return { errors: false, items: [{ index: { status: 200 } }] };
    };

    const first = rebuildSearchIndex({ client });
    // The flag is set synchronously before the first await, so a second
    // call is rejected immediately - deterministic, no timing needed.
    const second = await rebuildSearchIndex({ client }).catch(
      (e: unknown) => e
    );
    expect(second).toBeInstanceOf(AppError);
    expect((second as AppError).code).toBe("REINDEX_IN_PROGRESS");
    expect((second as AppError).statusCode).toBe(409);

    releaseBulk();
    const report = await first;
    expect(report.indexed).toBe(1);

    // The guard resets - a subsequent rebuild can run.
    const again = await rebuildSearchIndex({ client });
    expect(again.indexed).toBe(1);
  });

  it("drops the half-built index and fails when bulk throws", async () => {
    await DocumentModel.deleteMany({});
    await seedDoc();

    const { client, state, calls } = fakeClient();
    client.bulk = async () => {
      throw new Error("cluster down");
    };

    await expect(rebuildSearchIndex({ client })).rejects.toBeInstanceOf(
      AppError
    );

    const created = (
      lastCall(calls, "indices.create") as { arg: { index: string } }
    ).arg.index;
    expect(state.indices.has(created)).toBe(false);
    expect(calls.some((c) => c.method === "indices.delete")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Search query building + response mapping                             */
/* ------------------------------------------------------------------ */

interface CapturedSearch {
  from: number;
  size: number;
  query: Record<string, unknown>;
  sort?: Record<string, unknown>[];
  highlight?: Record<string, unknown>;
}

const hit = (overrides: Partial<EsHit> = {}): EsHit => ({
  _id: "doc1",
  _score: 4.2,
  _source: {
    title: "Node.js Streams",
    url: "https://nodejs.org/api/stream.html",
    source: "nodejs",
    category: "documentation",
    contentType: "html",
    technologies: ["nodejs"],
    author: "Node Team",
    publishedAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-06-01T00:00:00.000Z",
  },
  highlight: {
    title: ["Node.js <mark>Streams</mark>"],
    content: ["<mark>Streams</mark> are collections"],
  },
  ...overrides,
});

describe("searchDocuments query construction", () => {
  it("builds a boosted multi_match with a technologies should-clause", async () => {
    const { client, calls } = fakeClient();
    await searchDocuments(query({ q: "streams" }), { client });

    const arg = lastCall(calls, "search")?.arg as CapturedSearch;
    const bool = (arg.query as { bool: Record<string, unknown> }).bool;
    expect(bool.must).toEqual([
      {
        multi_match: {
          query: "streams",
          fields: ["title^3", "content"],
          type: "best_fields",
        },
      },
    ]);
    expect(bool.should).toEqual([
      { term: { technologies: { value: "streams", boost: 2 } } },
    ]);
    expect(bool).not.toHaveProperty("filter");
    // Relevance ordering: no explicit sort for a text query.
    expect(arg.sort).toBeUndefined();
  });

  it("puts category/source/technology/contentType filters in filter context", async () => {
    const { client, calls } = fakeClient();
    await searchDocuments(
      query({
        q: "x",
        category: "documentation",
        source: "MDN",
        technology: "JavaScript",
        contentType: "html",
      }),
      { client }
    );

    const arg = lastCall(calls, "search")?.arg as CapturedSearch;
    const bool = (arg.query as { bool: Record<string, unknown> }).bool;
    expect(bool.filter).toEqual([
      { term: { category: "documentation" } },
      { term: { source: "mdn" } },
      { term: { contentType: "html" } },
      { term: { technologies: "javascript" } },
    ]);
  });

  it("degrades an empty query to match_all sorted by updatedAt desc", async () => {
    const { client, calls } = fakeClient();
    await searchDocuments(query(), { client });

    const arg = lastCall(calls, "search")?.arg as CapturedSearch;
    const bool = (arg.query as { bool: Record<string, unknown> }).bool;
    expect(bool.must).toEqual([{ match_all: {} }]);
    expect(bool).not.toHaveProperty("should");
    expect(arg.sort).toEqual([{ updatedAt: { order: "desc" } }]);
  });

  it("computes from/size from page and limit", async () => {
    const { client, calls } = fakeClient();
    await searchDocuments(query({ page: 3, limit: 10 }), { client });
    const arg = lastCall(calls, "search")?.arg as CapturedSearch;
    expect(arg.from).toBe(20);
    expect(arg.size).toBe(10);
  });

  it("requests highlighting on title and content", async () => {
    const { client, calls } = fakeClient();
    await searchDocuments(query({ q: "x" }), { client });
    const arg = lastCall(calls, "search")?.arg as CapturedSearch;
    expect(arg.highlight).toMatchObject({
      pre_tags: ["<mark>"],
      post_tags: ["</mark>"],
    });
    expect(
      (arg.highlight as { fields: Record<string, unknown> }).fields
    ).toHaveProperty("content");
    expect(
      (arg.highlight as { fields: Record<string, unknown> }).fields
    ).toHaveProperty("title");
  });
});

describe("searchDocuments response mapping", () => {
  it("maps hits and object-total to a clean response", async () => {
    const { client } = fakeClient({
      searchResponse: {
        hits: { total: { value: 42 }, hits: [hit()] },
      },
    });

    const res = await searchDocuments(query({ q: "streams", limit: 10 }), {
      client,
    });

    expect(res.pagination).toEqual({
      page: 1,
      limit: 10,
      total: 42,
      totalPages: 5,
    });
    const r = res.results[0]!;
    expect(r.id).toBe("doc1");
    expect(r.score).toBe(4.2);
    expect(r.highlights.title).toEqual(["Node.js <mark>Streams</mark>"]);
    expect(r.author).toBe("Node Team");
    // no raw ES internals leak through
    expect(r).not.toHaveProperty("_source");
    expect(r).not.toHaveProperty("_index");
  });

  it("handles numeric total and missing score/highlight", async () => {
    const { client } = fakeClient({
      searchResponse: {
        hits: {
          total: 1,
          hits: [hit({ _score: null, highlight: undefined })],
        },
      },
    });
    const res = await searchDocuments(query(), { client });
    expect(res.pagination.total).toBe(1);
    expect(res.results[0]!.score).toBe(0);
    expect(res.results[0]!.highlights).toEqual({ title: [], content: [] });
  });

  it("maps Elasticsearch failure to a 503 AppError", async () => {
    const { client } = fakeClient();
    client.search = async () => {
      throw new Error("Connection refused");
    };
    await expect(searchDocuments(query(), { client })).rejects.toMatchObject({
      statusCode: 503,
      code: "SEARCH_UNAVAILABLE",
    });
  });
});
