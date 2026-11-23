import { describe, expect, it, vi } from "vitest";
import {
  MAX_PASSAGE_WINDOW,
  passageSearchDocuments,
  PASSAGE_MAX_PER_DOC,
  PASSAGE_WINDOW_SIZE,
} from "../src/features/search/services/chunk-search.service.js";
import type { EmbeddingProvider } from "../src/features/search/services/embedding.provider.js";
import type {
  EsClientLike,
  EsHit,
  EsSearchResponse,
} from "../src/features/search/types/search.types.js";
import type { SearchQuery } from "../src/features/search/validators/search.validators.js";

const CHUNK_ALIAS = "searchforge-chunks";

const provider: EmbeddingProvider = {
  model: "test-model",
  dims: 3,
  embedDocuments: async (texts) => texts.map(() => [0.1, 0.2, 0.3]),
  embedQuery: vi.fn(async () => [0.1, 0.2, 0.3]),
};

const failingProvider: EmbeddingProvider = {
  ...provider,
  embedQuery: vi.fn(async () => {
    throw new Error("voyage down");
  }),
};

const hit = (
  id: string,
  parentId: string,
  extra: Record<string, unknown> = {}
): EsHit => ({
  _id: id,
  _source: {
    parent_document_id: parentId,
    chunk_index: 0,
    title: `Doc ${parentId}`,
    url: `https://example.com/${parentId}`,
    source: "example",
    category: "documentation",
    contentType: "html",
    technologies: ["nodejs"],
    heading: "",
    content: `passage content for ${id}`,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  },
});

interface FakeSearchCall {
  index: string;
  size: number;
  query?: Record<string, unknown>;
  knn?: Record<string, unknown>;
}

const makeClient = (
  opts: {
    bm25?: EsSearchResponse | Error;
    knn?: EsSearchResponse | Error;
    countValue?: number;
  } = {}
) => {
  const searchCalls: FakeSearchCall[] = [];
  const countCalls: { index: string; query?: Record<string, unknown> }[] =
    [];
  const client: EsClientLike = {
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
    count: async (o) => {
      countCalls.push(o);
      return { count: opts.countValue ?? 0 };
    },
    search: async (a) => {
      searchCalls.push(a as FakeSearchCall);
      const branch = a.knn ? opts.knn : opts.bm25;
      if (branch instanceof Error) {
        throw branch;
      }
      return branch ?? { hits: { total: 0, hits: [] } };
    },
  };
  return { client, searchCalls, countCalls };
};

const response = (...hits: EsHit[]): EsSearchResponse => ({
  hits: { total: hits.length, hits },
});

const query = (overrides: Partial<SearchQuery> = {}): SearchQuery => ({
  q: "streams backpressure",
  page: 1,
  limit: 10,
  mode: "passage",
  ...overrides,
});

describe("passageSearchDocuments", () => {
  it("fuses chunk BM25 and kNN legs and returns passage items", async () => {
    const { client, searchCalls } = makeClient({
      bm25: response(hit("docA:0", "docA"), hit("docB:0", "docB")),
      knn: response(hit("docB:0", "docB"), hit("docC:1", "docC")),
      countValue: 3,
    });

    const out = await passageSearchDocuments(query(), {
      client,
      embeddingProvider: provider,
    });

    expect(searchCalls).toHaveLength(2);
    expect(searchCalls.every((c) => c.index === CHUNK_ALIAS)).toBe(true);
    expect(searchCalls[0]!.size).toBe(PASSAGE_WINDOW_SIZE);

    // docB:0 is in both lists -> fused first.
    expect(out.results[0]!.id).toBe("docB:0");
    expect(out.results[0]!.documentId).toBe("docB");
    expect(out.results.map((r) => r.id)).toEqual([
      "docB:0",
      "docA:0",
      "docC:1",
    ]);
    expect(out.results[0]!.score).toBeGreaterThan(0);
    expect(out.pagination.total).toBe(3);
  });

  it("applies the same metadata filters to both legs", async () => {
    const { client, searchCalls } = makeClient({ countValue: 0 });
    await passageSearchDocuments(
      query({ source: "NodeJS", technology: "Streams" }),
      { client, embeddingProvider: provider }
    );

    const bm25Filter = (
      searchCalls[0]!.query as { bool: { filter: unknown[] } }
    ).bool.filter;
    const knnFilter = (searchCalls[1]!.knn as { filter: unknown[] }).filter;
    expect(bm25Filter).toEqual([
      { term: { source: "nodejs" } },
      { term: { technologies: "streams" } },
    ]);
    expect(knnFilter).toEqual(bm25Filter);
  });

  it("collapses to at most PASSAGE_MAX_PER_DOC chunks per parent", async () => {
    const { client } = makeClient({
      bm25: response(
        hit("docA:0", "docA"),
        hit("docA:1", "docA"),
        hit("docA:2", "docA"),
        hit("docB:0", "docB")
      ),
      knn: response(),
      countValue: 4,
    });

    const out = await passageSearchDocuments(query(), {
      client,
      embeddingProvider: provider,
    });

    const docA = out.results.filter((r) => r.documentId === "docA");
    expect(docA).toHaveLength(PASSAGE_MAX_PER_DOC);
    expect(out.results.at(-1)?.documentId).toBe("docB");
  });

  it("bounds total to the fusion window", async () => {
    const { client } = makeClient({ countValue: 500 });
    const out = await passageSearchDocuments(query(), {
      client,
      embeddingProvider: provider,
    });
    expect(out.pagination.total).toBe(PASSAGE_WINDOW_SIZE);
  });

  it("reports the union count query shape", async () => {
    const { client, countCalls } = makeClient({ countValue: 7 });
    await passageSearchDocuments(query(), {
      client,
      embeddingProvider: provider,
    });
    expect(countCalls).toHaveLength(1);
    expect(countCalls[0]!.index).toBe(CHUNK_ALIAS);
    const bool = (countCalls[0]!.query as { bool: Record<string, unknown> })
      .bool;
    expect(bool.minimum_should_match).toBe(1);
    expect(bool.should).toHaveLength(2);
    expect(JSON.stringify(bool.should)).toContain("content_vector");
    expect(JSON.stringify(bool.should)).toContain("multi_match");
  });

  it("slices the requested page from the fused list", async () => {
    const hits = Array.from({ length: 8 }, (_, i) =>
      hit(`doc${i}:0`, `doc${i}`)
    );
    const { client } = makeClient({
      bm25: response(...hits),
      knn: response(),
      countValue: 8,
    });
    const out = await passageSearchDocuments(query({ page: 2, limit: 3 }), {
      client,
      embeddingProvider: provider,
    });
    expect(out.results.map((r) => r.id)).toEqual([
      "doc3:0",
      "doc4:0",
      "doc5:0",
    ]);
  });

  it("throws PASSAGE_UNAVAILABLE when no provider is configured", async () => {
    const { client, searchCalls } = makeClient();
    await expect(
      passageSearchDocuments(query(), {
        client,
        embeddingProvider: null,
      })
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "PASSAGE_UNAVAILABLE",
    });
    expect(searchCalls).toHaveLength(0);
  });

  it("throws SEARCH_UNAVAILABLE when the chunk BM25 leg fails", async () => {
    const { client } = makeClient({ bm25: new Error("es down") });
    await expect(
      passageSearchDocuments(query(), {
        client,
        embeddingProvider: provider,
      })
    ).rejects.toMatchObject({ statusCode: 503, code: "SEARCH_UNAVAILABLE" });
  });

  it("throws PASSAGE_UNAVAILABLE when query embedding fails", async () => {
    const { client } = makeClient({ bm25: response() });
    await expect(
      passageSearchDocuments(query(), {
        client,
        embeddingProvider: failingProvider,
      })
    ).rejects.toMatchObject({ statusCode: 503, code: "PASSAGE_UNAVAILABLE" });
  });

  it("throws SEARCH_UNAVAILABLE when the kNN leg fails", async () => {
    const { client } = makeClient({
      bm25: response(),
      knn: new Error("es down"),
    });
    await expect(
      passageSearchDocuments(query(), {
        client,
        embeddingProvider: provider,
      })
    ).rejects.toMatchObject({ statusCode: 503, code: "SEARCH_UNAVAILABLE" });
  });

  it("clamps an oversized passage window override", async () => {
    const { client, searchCalls } = makeClient({});
    await passageSearchDocuments(query(), {
      client,
      embeddingProvider: provider,
      searchConfig: {
        titleBoost: 3,
        contentBoost: 1,
        technologiesBoost: 2,
        passageWindow: 50_000,
      },
    });
    expect(searchCalls[0]!.size).toBe(MAX_PASSAGE_WINDOW);
  });

  it("maps excerpt and highlights onto the result item", async () => {
    const long = "x".repeat(700);
    const { client } = makeClient({
      bm25: {
        hits: {
          total: 1,
          hits: [
            {
              _id: "docA:0",
              _score: 5,
              _source: {
                parent_document_id: "docA",
                chunk_index: 0,
                title: "Streams",
                url: "https://example.com/a",
                source: "nodejs",
                category: "documentation",
                contentType: "html",
                technologies: [],
                heading: "Backpressure",
                content: long,
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
              highlight: {
                content: ["<mark>streams</mark> excerpt"],
                heading: ["<mark>Backpressure</mark>"],
              },
            },
          ],
        },
      },
      knn: response(),
      countValue: 1,
    });

    const out = await passageSearchDocuments(query(), {
      client,
      embeddingProvider: provider,
    });
    const item = out.results[0]!;
    expect(item.heading).toBe("Backpressure");
    expect(item.excerpt.length).toBeLessThanOrEqual(601);
    expect(item.highlights.content).toEqual(["<mark>streams</mark> excerpt"]);
    expect(item.highlights.heading).toEqual(["<mark>Backpressure</mark>"]);
  });
});
