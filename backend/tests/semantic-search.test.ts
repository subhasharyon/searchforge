import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DocumentModel } from "../src/features/documents/models/document.model.js";
import { documentRepository } from "../src/features/documents/repositories/document.repository.js";
import {
  embeddingDeps,
  EmbeddingError,
  assertEmbedding,
  buildEmbeddingInput,
  embeddingIsStale,
  type EmbeddingProvider,
} from "../src/features/search/services/embedding.provider.js";
import { LocalHashEmbeddingProvider } from "../src/features/search/services/local-embedding.provider.js";
import { OpenAiCompatEmbeddingProvider } from "../src/features/search/services/openai-compat.provider.js";
import { getEmbeddingProvider } from "../src/features/search/services/embedding.service.js";
import { syncDocumentToIndex } from "../src/features/search/services/indexing.service.js";
import {
  buildSearchMappings,
  VECTOR_FIELD,
} from "../src/features/search/services/index-manager.service.js";
import { rebuildSearchIndex } from "../src/features/search/services/reindex.service.js";
import { semanticSearchDocuments } from "../src/features/search/services/search.service.js";
import { searchQuerySchema } from "../src/features/search/validators/search.validators.js";
import type {
  EsClientLike,
  EsSearchResponse,
} from "../src/features/search/types/search.types.js";
import { startTestDb, stopTestDb } from "./helpers/test-db.js";

/* ------------------------------------------------------------------ */
/* Fakes                                                               */
/* ------------------------------------------------------------------ */

const DIMS = 32;

const fakeProvider = (
  overrides: Partial<EmbeddingProvider> = {}
): EmbeddingProvider => ({
  model: "test-model-v1",
  dims: DIMS,
  embedDocuments: vi.fn(async (texts: readonly string[]) =>
    texts.map(() => Array.from({ length: DIMS }, () => 0.5))
  ),
  embedQuery: vi.fn(async () =>
    Array.from({ length: DIMS }, () => 0.25)
  ),
  ...overrides,
});

const esNotFound = (): Error & { statusCode: number } =>
  Object.assign(new Error("not found"), { statusCode: 404 });

const fakeClient = (
  opts: {
    searchResponse?: EsSearchResponse;
    bulkErrors?: boolean;
    countValue?: number;
  } = {}
) => {
  const state = { indices: new Set<string>(), aliases: new Map<string, string>() };
  const calls: { method: string; arg: unknown }[] = [];
  const client: EsClientLike = {
    indices: {
      exists: async (a) => state.indices.has(a.index),
      create: async (a) => {
        state.indices.add(a.index);
        calls.push({ method: "indices.create", arg: a });
        return {};
      },
      delete: async (a) => {
        state.indices.delete(a.index);
        return {};
      },
      getAlias: async (a) => {
        const t = state.aliases.get(a.name);
        if (!t) throw esNotFound();
        return { [t]: {} };
      },
      existsAlias: async (a) => state.aliases.has(a.name),
      updateAliases: async (a) => {
        for (const action of a.actions) {
          const add = action.add as { index: string; alias: string } | undefined;
          const rm = action.remove_index as { index: string } | undefined;
          if (add) state.aliases.set(add.alias, add.index);
          if (rm) state.indices.delete(rm.index);
        }
        calls.push({ method: "indices.updateAliases", arg: a });
        return {};
      },
    },
    index: async (a) => {
      calls.push({ method: "index", arg: a });
      return {};
    },
    delete: async () => ({}),
    bulk: async (a) => {
      calls.push({ method: "bulk", arg: a });
      if (opts.bulkErrors) {
        return {
          errors: true,
          items: a.operations
            .filter((_, i) => i % 2 === 0)
            .map(() => ({ index: { status: 400, error: { reason: "bad doc" } } })),
        };
      }
      return {
        errors: false,
        items: a.operations
          .filter((_, i) => i % 2 === 0)
          .map(() => ({ index: { status: 200 } })),
      };
    },
    count: async (a) => {
      calls.push({ method: "count", arg: a });
      return { count: opts.countValue ?? 0 };
    },
    search: async (a) => {
      calls.push({ method: "search", arg: a });
      return opts.searchResponse ?? { hits: { total: 0, hits: [] } };
    },
  };
  return { client, state, calls };
};

const makeDoc = async (overrides: Record<string, unknown> = {}) =>
  documentRepository.create({
    title: "Node.js Streams guide",
    url: `https://example.com/${Math.random().toString(36).slice(2)}`,
    source: "test",
    category: "documentation",
    contentType: "markdown",
    technologies: ["nodejs"],
    content: "Readable writable duplex transform streams.",
    contentHash:
      "a".repeat(64),
    ...overrides,
  });

beforeAll(startTestDb);
afterAll(stopTestDb);
afterEach(async () => {
  delete embeddingDeps.provider;
  vi.restoreAllMocks();
  await DocumentModel.deleteMany({});
});

/* ------------------------------------------------------------------ */
/* Provider layer                                                      */
/* ------------------------------------------------------------------ */

describe("assertEmbedding", () => {
  it("accepts a valid vector of the configured dimension", () => {
    const v = Array.from({ length: DIMS }, () => 0.1);
    expect(assertEmbedding(v, DIMS)).toEqual(v);
  });

  it.each([
    ["wrong length", [0.1, 0.2]],
    ["non-finite", [...Array.from({ length: DIMS - 1 }, () => 0.1), Number.NaN]],
    ["not an array", "vector"],
  ])("rejects malformed vectors: %s", (_label, bad) => {
    expect(() => assertEmbedding(bad, DIMS)).toThrow(EmbeddingError);
  });
});

describe("LocalHashEmbeddingProvider", () => {
  it("produces deterministic, unit-normalized vectors of the right dims", async () => {
    const p = new LocalHashEmbeddingProvider(64);
    const a = await p.embedQuery("nodejs streams guide");
    const b = await p.embedQuery("nodejs streams guide");
    expect(a).toHaveLength(64);
    expect(a).toEqual(b);
    const norm = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });
});

describe("OpenAiCompatEmbeddingProvider", () => {
  const makeProvider = () =>
    new OpenAiCompatEmbeddingProvider("m-v1", DIMS, "https://api.test/v1", "k", 50);

  const okBody = (n: number) =>
    JSON.stringify({
      data: Array.from({ length: n }, (_, i) => ({
        index: i,
        embedding: Array.from({ length: DIMS }, () => 0.1),
      })).reverse(), // unordered index - adapter must re-sort
    });

  it("embeds documents via the OpenAI response contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(okBody(2), { status: 200 }))
    );
    const vectors = await makeProvider().embedDocuments(["a", "b"]);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(DIMS);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("embedQuery returns a single vector", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(okBody(1), { status: 200 }))
    );
    const v = await makeProvider().embedQuery("q");
    expect(v).toHaveLength(DIMS);
  });

  it("maps 401 to a non-retryable auth error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 }))
    );
    await expect(makeProvider().embedQuery("q")).rejects.toMatchObject({
      code: "EMBEDDING_AUTH_FAILED",
      retryable: false,
    });
  });

  it("retries 429 then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockResolvedValueOnce(new Response(okBody(1), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const v = await makeProvider().embedQuery("q");
    expect(v).toHaveLength(DIMS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces rate limiting after bounded retries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 429 }))
    );
    await expect(makeProvider().embedQuery("q")).rejects.toMatchObject({
      code: "EMBEDDING_RATE_LIMITED",
    });
  });

  it("times out a hung provider", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_u: unknown, init?: RequestInit) =>
          new Promise((_res, rej) => {
            init?.signal?.addEventListener("abort", () =>
              rej(new DOMException("Aborted", "AbortError"))
            );
          })
      )
    );
    await expect(makeProvider().embedQuery("q")).rejects.toMatchObject({
      code: "EMBEDDING_TRANSPORT",
    });
  });

  it("rejects a malformed provider response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }))
    );
    await expect(makeProvider().embedQuery("q")).rejects.toMatchObject({
      code: "EMBEDDING_BAD_RESPONSE",
    });
  });
});

describe("getEmbeddingProvider", () => {
  it("resolves through the deps seam (explicit null = unconfigured)", () => {
    embeddingDeps.provider = null;
    expect(getEmbeddingProvider()).toBeNull();
    embeddingDeps.provider = fakeProvider();
    expect(getEmbeddingProvider()?.model).toBe("test-model-v1");
  });
});

describe("embeddingIsStale / buildEmbeddingInput", () => {
  it("flags missing vector, hash change, and model change as stale", () => {
    const p = fakeProvider();
    const base = { contentHash: "h1", contentVector: [0.1], embeddingModel: "test-model-v1", embeddedContentHash: "h1" };
    expect(embeddingIsStale(base, p)).toBe(false);
    expect(embeddingIsStale({ ...base, contentVector: [] }, p)).toBe(true);
    expect(embeddingIsStale({ ...base, embeddedContentHash: "h2" }, p)).toBe(true);
    expect(embeddingIsStale({ ...base, embeddingModel: "other" }, p)).toBe(true);
  });

  it("embedding input repeats the title for topical weight", () => {
    expect(buildEmbeddingInput("T", "C")).toBe("T\n\nT\n\nC");
  });
});

describe("buildSearchMappings", () => {
  it("adds a cosine int8_hnsw vector field only when dims are provided", () => {
    const withV = buildSearchMappings(768) as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(withV.properties[VECTOR_FIELD]).toMatchObject({
      dims: 768,
      similarity: "cosine",
    });
    expect(withV.properties.title?.type).toBe("text");
    const without = buildSearchMappings() as { properties: object };
    expect(VECTOR_FIELD in without.properties).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Ingestion sync                                                      */
/* ------------------------------------------------------------------ */

describe("syncDocumentToIndex embedding behaviour", () => {
  it("embeds and indexes the vector on create", async () => {
    const provider = fakeProvider();
    const { client, calls } = fakeClient();
    const doc = await makeDoc();
    await syncDocumentToIndex(doc, { client, embeddingProvider: provider });
    expect(provider.embedDocuments).toHaveBeenCalledTimes(1);
    const indexed = calls.find((c) => c.method === "index")!.arg as {
      document: { content_vector?: number[]; embeddingModel?: string };
    };
    expect(indexed.document.content_vector).toHaveLength(DIMS);
    expect(indexed.document.embeddingModel).toBe("test-model-v1");
    const saved = await DocumentModel.findById(doc._id);
    expect(saved?.embeddedContentHash).toBe(doc.contentHash);
  });

  it("indexes the plain document when the provider fails", async () => {
    const provider = fakeProvider({
      embedDocuments: vi.fn(async () => {
        throw new EmbeddingError("down", "EMBEDDING_PROVIDER_ERROR", true);
      }),
    });
    const { client, calls } = fakeClient();
    const doc = await makeDoc();
    await syncDocumentToIndex(doc, { client, embeddingProvider: provider });
    const indexed = calls.find((c) => c.method === "index")!.arg as {
      document: Record<string, unknown>;
    };
    expect(indexed.document.title).toBe("Node.js Streams guide");
    expect(indexed.document.content_vector).toBeUndefined();
  });

  it("does not re-embed when content is unchanged", async () => {
    const provider = fakeProvider();
    const { client } = fakeClient();
    const doc = await makeDoc({
      contentVector: [0.9, 0.1],
      embeddingModel: "test-model-v1",
      embeddedContentHash: "a".repeat(64),
    });
    await syncDocumentToIndex(doc, { client, embeddingProvider: provider });
    expect(provider.embedDocuments).not.toHaveBeenCalled();
  });

  it("re-embeds when content changed", async () => {
    const provider = fakeProvider();
    const { client } = fakeClient();
    const doc = await makeDoc({
      contentVector: [0.9, 0.1],
      embeddingModel: "test-model-v1",
      embeddedContentHash: "b".repeat(64), // differs from contentHash
    });
    await syncDocumentToIndex(doc, { client, embeddingProvider: provider });
    expect(provider.embedDocuments).toHaveBeenCalledTimes(1);
  });

  it("clears a stale vector from Mongo when re-embedding fails", async () => {
    const provider = fakeProvider({
      embedDocuments: vi.fn(async () => {
        throw new EmbeddingError("down", "EMBEDDING_PROVIDER_ERROR", true);
      }),
    });
    const { client, calls } = fakeClient();
    const doc = await makeDoc({
      contentVector: [0.9, 0.1],
      embeddingModel: "test-model-v1",
      embeddedContentHash: "b".repeat(64),
    });
    await syncDocumentToIndex(doc, { client, embeddingProvider: provider });
    const indexed = calls.find((c) => c.method === "index")!.arg as {
      document: Record<string, unknown>;
    };
    expect(indexed.document.content_vector).toBeUndefined();
    const saved = await DocumentModel.findById(doc._id);
    expect(saved?.contentVector ?? []).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Reindex                                                             */
/* ------------------------------------------------------------------ */

describe("rebuildSearchIndex with embeddings", () => {
  it("embeds docs, reports coverage, and swaps the alias", async () => {
    await makeDoc();
    await makeDoc({
      title: "Other doc",
      contentVector: [0.5, 0.5],
      embeddingModel: "test-model-v1",
      embeddedContentHash: "a".repeat(64),
    });
    const provider = fakeProvider();
    const { client, state } = fakeClient();
    const report = await rebuildSearchIndex({ client, embeddingProvider: provider });
    expect(report.indexed).toBe(2);
    expect(report.embedded).toBe(1);
    expect(report.vectorsReused).toBe(1);
    expect(report.embeddingFailed).toBe(0);
    expect(state.aliases.get("searchforge-documents")).toBe(report.toIndex);
  });

  it("embedding failure does not abort the keyword rebuild", async () => {
    await makeDoc();
    const provider = fakeProvider({
      embedDocuments: vi.fn(async () => {
        throw new EmbeddingError("down", "EMBEDDING_PROVIDER_ERROR", true);
      }),
    });
    const { client, state, calls } = fakeClient();
    const report = await rebuildSearchIndex({ client, embeddingProvider: provider });
    expect(report.indexed).toBe(1);
    expect(report.embeddingFailed).toBe(1);
    expect(state.aliases.get("searchforge-documents")).toBe(report.toIndex);
    const bulk = calls.find((c) => c.method === "bulk")!.arg as {
      operations: unknown[];
    };
    const docPayload = bulk.operations[1] as Record<string, unknown>;
    expect(docPayload.content_vector).toBeUndefined();
  });

  it("works end-to-end with the local provider when injected", async () => {
    await makeDoc();
    embeddingDeps.provider = new LocalHashEmbeddingProvider(DIMS);
    const { client } = fakeClient();
    const report = await rebuildSearchIndex({ client });
    expect(report.indexed).toBe(1);
    expect(report.embedded).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Semantic search                                                     */
/* ------------------------------------------------------------------ */

describe("searchQuerySchema mode validation", () => {
  it("defaults missing mode to keyword", () => {
    expect(searchQuerySchema.parse({ q: "x" }).mode).toBe("keyword");
  });
  it("accepts semantic with a query", () => {
    expect(searchQuerySchema.parse({ q: "x", mode: "semantic" }).mode).toBe(
      "semantic"
    );
  });
  it("rejects semantic without a query", () => {
    expect(() => searchQuerySchema.parse({ mode: "semantic" })).toThrow();
  });
  it("rejects an unknown mode", () => {
    expect(() => searchQuerySchema.parse({ q: "x", mode: "bogus" })).toThrow();
  });
});

describe("semanticSearchDocuments", () => {
  const semQ = (over: Record<string, unknown> = {}) =>
    ({
      q: "nodejs streams",
      page: 1,
      limit: 10,
      mode: "semantic",
      ...over,
    }) as never;

  it("throws SEMANTIC_UNAVAILABLE when no provider is configured", async () => {
    await expect(
      semanticSearchDocuments(semQ(), {
        client: fakeClient().client,
        embeddingProvider: null,
      })
    ).rejects.toMatchObject({ code: "SEMANTIC_UNAVAILABLE", statusCode: 503 });
  });

  it("embeds the query, runs kNN with filters, and preserves the envelope", async () => {
    const provider = fakeProvider();
    const searchResponse: EsSearchResponse = {
      hits: {
        total: { value: 3 },
        hits: [
          { _id: "64b1f5c8d2a1e9f0a1b2c3d4", _score: 0.9, _source: { title: "T1", url: "u", source: "s", category: "documentation", contentType: "markdown", technologies: [], updatedAt: "2026-01-01" } },
          { _id: "64b1f5c8d2a1e9f0a1b2c3d5", _score: 0.8, _source: { title: "T2", url: "u", source: "s", category: "documentation", contentType: "markdown", technologies: [], updatedAt: "2026-01-01" } },
        ],
      },
    };
    const { client, calls } = fakeClient({ searchResponse, countValue: 7 });
    const res = await semanticSearchDocuments(
      semQ({ category: "documentation", limit: 1 }),
      { client, embeddingProvider: provider }
    );
    expect(provider.embedQuery).toHaveBeenCalledWith("nodejs streams");
    const knnArg = (
      calls.find((c) => c.method === "search")!.arg as {
        knn: {
          field: string;
          k: number;
          filter?: unknown[];
          query_vector: number[];
        };
      }
    ).knn;
    expect(knnArg.field).toBe(VECTOR_FIELD);
    expect(knnArg.query_vector).toHaveLength(DIMS);
    expect(knnArg.filter).toEqual([{ term: { category: "documentation" } }]);
    // page 1 limit 1 -> first hit only, id stays the Mongo _id
    expect(res.results).toHaveLength(1);
    expect(res.results[0]!.id).toBe("64b1f5c8d2a1e9f0a1b2c3d4");
    expect(res.results[0]!.highlights).toEqual({ title: [], content: [] });
    expect(res.pagination.total).toBe(7);
    expect(res.pagination.totalPages).toBe(7);
  });

  it("slices the requested page out of the top-k result", async () => {
    const provider = fakeProvider();
    const hits = [1, 2, 3, 4].map((n) => ({
      _id: `id${n}`,
      _score: 1 / n,
      _source: { title: `T${n}`, updatedAt: "2026-01-01" },
    }));
    const { client, calls } = fakeClient({
      searchResponse: { hits: { total: { value: 4 }, hits } },
      countValue: 4,
    });
    const res = await semanticSearchDocuments(semQ({ page: 2, limit: 2 }), {
      client,
      embeddingProvider: provider,
    });
    const knnArg = (calls.find((c) => c.method === "search")!.arg as {
      knn: { k: number };
    }).knn;
    expect(knnArg.k).toBe(4); // page*limit over-fetch
    expect(res.results.map((r) => r.id)).toEqual(["id3", "id4"]);
  });

  it("provider outage maps to a clear 503", async () => {
    const provider = fakeProvider({
      embedQuery: vi.fn(async () => {
        throw new EmbeddingError("down", "EMBEDDING_PROVIDER_ERROR", true);
      }),
    });
    await expect(
      semanticSearchDocuments(semQ(), {
        client: fakeClient().client,
        embeddingProvider: provider,
      })
    ).rejects.toMatchObject({ code: "SEMANTIC_UNAVAILABLE" });
  });

  it("ES failure maps to SEARCH_UNAVAILABLE", async () => {
    const provider = fakeProvider();
    const { client } = fakeClient();
    client.search = async () => {
      throw new Error("boom");
    };
    await expect(
      semanticSearchDocuments(semQ(), { client, embeddingProvider: provider })
    ).rejects.toMatchObject({ code: "SEARCH_UNAVAILABLE" });
  });
});
