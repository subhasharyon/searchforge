import { describe, expect, it, vi } from "vitest";
import { embeddingDeps, type EmbeddingProvider } from "../src/features/search/services/embedding.provider.js";
import {
  fuseRrf,
  hybridSearchDocuments,
  HYBRID_RANK_CONSTANT,
  HYBRID_WINDOW_SIZE,
} from "../src/features/search/services/search.service.js";
import { VECTOR_FIELD } from "../src/features/search/services/index-manager.service.js";
import { searchQuerySchema } from "../src/features/search/validators/search.validators.js";
import type {
  EsClientLike,
  EsHit,
  EsSearchResponse,
} from "../src/features/search/types/search.types.js";

/* ------------------------------------------------------------------ */
/* Fakes                                                               */
/* ------------------------------------------------------------------ */

const DIMS = 8;

const fakeProvider = (
  overrides: Partial<EmbeddingProvider> = {}
): EmbeddingProvider => ({
  model: "test-model-v1",
  dims: DIMS,
  embedDocuments: vi.fn(async (texts: readonly string[]) =>
    texts.map(() => Array.from({ length: DIMS }, () => 0.5))
  ),
  embedQuery: vi.fn(async () => Array.from({ length: DIMS }, () => 0.25)),
  ...overrides,
});

interface FakeSearchCall {
  index: string;
  size: number;
  query?: Record<string, unknown>;
  knn?: Record<string, unknown>;
  highlight?: Record<string, unknown>;
  _source?: string[] | boolean;
}

/** Returns different responses for the BM25 branch (has `query`) vs the
    kNN branch (has `knn`); rejects either branch on demand. */
const fakeHybridClient = (
  opts: {
    bm25?: EsSearchResponse | Error;
    knn?: EsSearchResponse | Error;
    countValue?: number;
  } = {}
) => {
  const searchCalls: FakeSearchCall[] = [];
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
    count: async () => ({ count: opts.countValue ?? 0 }),
    search: async (a) => {
      searchCalls.push(a as FakeSearchCall);
      const branch = a.knn ? opts.knn : opts.bm25;
      if (branch instanceof Error) {
        throw branch;
      }
      return branch ?? { hits: { total: 0, hits: [] } };
    },
  };
  return { client, searchCalls };
};

const hit = (id: string, score = 1, extra: Partial<EsHit> = {}): EsHit => ({
  _id: id,
  _score: score,
  _source: {
    title: `Doc ${id}`,
    url: `https://example.com/${id}`,
    source: "test",
    category: "documentation",
    contentType: "markdown",
    technologies: [],
    updatedAt: "2026-01-01",
  },
  ...extra,
});

const hybridQ = (over: Record<string, unknown> = {}) =>
  ({
    q: "nodejs streams",
    page: 1,
    limit: 10,
    mode: "hybrid",
    ...over,
  }) as never;

/* ------------------------------------------------------------------ */
/* fuseRrf - pure fusion math                                          */
/* ------------------------------------------------------------------ */

describe("fuseRrf", () => {
  it("scores by reciprocal rank and merges shared documents", () => {
    // a: rank 1 in both branches -> 1/(k+1) + 1/(k+1)
    // b: rank 2 in BM25 only      -> 1/(k+2)
    // c: rank 2 in kNN only       -> 1/(k+2)
    const bm25 = [hit("a"), hit("b")];
    const knn = [hit("a"), hit("c")];
    const fused = fuseRrf([bm25, knn], HYBRID_RANK_CONSTANT);
    expect(fused.map((h) => h._id)).toEqual(["a", "b", "c"]);
    expect(fused[0]!._score).toBeCloseTo(
      1 / (HYBRID_RANK_CONSTANT + 1) + 1 / (HYBRID_RANK_CONSTANT + 1)
    );
    expect(fused[1]!._score).toBeCloseTo(1 / (HYBRID_RANK_CONSTANT + 2));
  });

  it("orders disjoint lists deterministically with _id tie-break", () => {
    const fused = fuseRrf([[hit("x"), hit("y")], [hit("z"), hit("w")]]);
    // all four share the same single-rank contribution pattern:
    // x,z at 1/(k+1) tie -> x before z; y,w at 1/(k+2) tie -> w before y? no: localeCompare
    const ids = fused.map((h) => h._id);
    expect(new Set(ids).size).toBe(4);
    expect(ids[0]).toBe("x"); // 1/(k+1), _id "x" < "z"
    expect(ids[1]).toBe("z");
    // lower-rank pair ties: "w" < "y"
    expect(ids[2]).toBe("w");
    expect(ids[3]).toBe("y");
  });

  it("a doc appearing only in kNN can outrank a lower BM25 doc", () => {
    // e is kNN rank1 (1/(k+1)); d is BM25 rank3 (1/(k+3))
    const fused = fuseRrf([
      [hit("a"), hit("b"), hit("d")],
      [hit("e")],
    ]);
    expect(fused[1]!._id).toBe("e");
  });

  it("keeps the BM25 hit (with highlight) for merged documents", () => {
    const highlighted = hit("a", 1, {
      highlight: { title: ["<mark>T</mark>"] },
    });
    const fused = fuseRrf([[highlighted], [hit("a")]]);
    expect(fused).toHaveLength(1);
    expect(fused[0]!.highlight?.title).toEqual(["<mark>T</mark>"]);
  });
});

/* ------------------------------------------------------------------ */
/* Validator                                                           */
/* ------------------------------------------------------------------ */

describe("searchQuerySchema hybrid validation", () => {
  it("accepts hybrid with a query", () => {
    expect(searchQuerySchema.parse({ q: "x", mode: "hybrid" }).mode).toBe(
      "hybrid"
    );
  });

  it("rejects hybrid without a query", () => {
    expect(() => searchQuerySchema.parse({ mode: "hybrid" })).toThrow();
  });

  it("rejects pages beyond the fusion window", () => {
    // window 100: page 11 * limit 10 = 110 -> out
    expect(() =>
      searchQuerySchema.parse({ q: "x", mode: "hybrid", page: 11, limit: 10 })
    ).toThrow();
    // page 10 * limit 10 = 100 -> exactly at the boundary, allowed
    expect(
      searchQuerySchema.parse({ q: "x", mode: "hybrid", page: 10, limit: 10 })
        .page
    ).toBe(10);
  });

  it("still allows deeper paging in keyword mode", () => {
    expect(
      searchQuerySchema.parse({ q: "x", mode: "keyword", page: 11, limit: 10 })
        .page
    ).toBe(11);
  });
});

/* ------------------------------------------------------------------ */
/* hybridSearchDocuments                                               */
/* ------------------------------------------------------------------ */

describe("hybridSearchDocuments", () => {
  it("throws HYBRID_UNAVAILABLE when no provider is configured", async () => {
    await expect(
      hybridSearchDocuments(hybridQ(), {
        client: fakeHybridClient().client,
        embeddingProvider: null,
      })
    ).rejects.toMatchObject({ code: "HYBRID_UNAVAILABLE", statusCode: 503 });
  });

  it("runs BM25+kNN, fuses ranks, and preserves ids + envelope", async () => {
    const provider = fakeProvider();
    const { client, searchCalls } = fakeHybridClient({
      bm25: {
        hits: {
          total: { value: 2 },
          hits: [
            hit("docA", 5, { highlight: { content: ["<mark>x</mark>"] } }),
            hit("docB", 4),
          ],
        },
      },
      knn: {
        hits: {
          total: { value: 2 },
          hits: [hit("docC", 0.9), hit("docA", 0.8)],
        },
      },
      countValue: 42,
    });

    const res = await hybridSearchDocuments(hybridQ(), {
      client,
      embeddingProvider: provider,
    });

    // both branches fired
    expect(searchCalls).toHaveLength(2);
    const bm25Call = searchCalls.find((c) => c.query)!;
    const knnCall = searchCalls.find((c) => c.knn)!;
    expect(bm25Call.size).toBe(HYBRID_WINDOW_SIZE);
    expect((knnCall.knn as { field: string }).field).toBe(VECTOR_FIELD);
    expect(
      (knnCall.knn as { query_vector: number[] }).query_vector
    ).toHaveLength(DIMS);
    expect(provider.embedQuery).toHaveBeenCalledWith("nodejs streams");

    // docA in both branches -> rank 1; then kNN-only docC vs BM25-only docB
    // docB: 1/(k+2); docC: 1/(k+1) -> docC first
    expect(res.results.map((r) => r.id)).toEqual(["docA", "docC", "docB"]);
    // BM25 highlight carried through the merge
    expect(res.results[0]!.highlights.content).toEqual(["<mark>x</mark>"]);
    // fused rrf score, not raw BM25/kNN score
    expect(res.results[0]!.score).toBeLessThan(1);
    // total bounded by the window contract: min(42, 100) = 42
    expect(res.pagination.total).toBe(42);
  });

  it("bounds total by the fusion window when the union exceeds it", async () => {
    const { client } = fakeHybridClient({
      bm25: { hits: { total: 0, hits: [hit("a")] } },
      countValue: 5000,
    });
    const res = await hybridSearchDocuments(hybridQ(), {
      client,
      embeddingProvider: fakeProvider(),
    });
    expect(res.pagination.total).toBe(HYBRID_WINDOW_SIZE);
  });

  it("applies metadata filters to both branches and the union count", async () => {
    const { client, searchCalls } = fakeHybridClient();
    const countSpy = vi.spyOn(client, "count");
    await hybridSearchDocuments(
      hybridQ({ category: "documentation", source: "NodeJS" }),
      { client, embeddingProvider: fakeProvider() }
    );
    const expected = [
      { term: { category: "documentation" } },
      { term: { source: "nodejs" } },
    ];
    const bm25Call = searchCalls.find((c) => c.query)!;
    const knnCall = searchCalls.find((c) => c.knn)!;
    expect(
      (bm25Call.query as { bool: { filter: unknown[] } }).bool.filter
    ).toEqual(expected);
    expect((knnCall.knn as { filter: unknown[] }).filter).toEqual(expected);
    const countQuery = countSpy.mock.calls[0]![0].query as {
      bool: { filter: unknown[]; should: unknown[]; minimum_should_match: number };
    };
    expect(countQuery.bool.filter).toEqual(expected);
    expect(countQuery.bool.minimum_should_match).toBe(1);
    // union = lexical match OR vectorized doc
    expect(countQuery.bool.should).toContainEqual({
      exists: { field: VECTOR_FIELD },
    });
  });

  it("slices the requested page from the fused window", async () => {
    const { client } = fakeHybridClient({
      bm25: {
        hits: { total: 4, hits: [hit("a"), hit("b"), hit("c"), hit("d")] },
      },
      countValue: 4,
    });
    const res = await hybridSearchDocuments(hybridQ({ page: 2, limit: 2 }), {
      client,
      embeddingProvider: fakeProvider(),
    });
    expect(res.results.map((r) => r.id)).toEqual(["c", "d"]);
  });

  it("provider outage rejects with HYBRID_UNAVAILABLE", async () => {
    const provider = fakeProvider({
      embedQuery: vi.fn(async () => {
        throw new Error("voyage down");
      }),
    });
    const { client } = fakeHybridClient({
      bm25: { hits: { total: 1, hits: [hit("a")] } },
    });
    await expect(
      hybridSearchDocuments(hybridQ(), {
        client,
        embeddingProvider: provider,
      })
    ).rejects.toMatchObject({ code: "HYBRID_UNAVAILABLE", statusCode: 503 });
  });

  it("simultaneous BM25+embed failure resolves to SEARCH_UNAVAILABLE", async () => {
    // Precedence rule: the ES leg is checked first, so a backend outage
    // is reported as SEARCH_UNAVAILABLE even when Voyage also failed.
    const provider = fakeProvider({
      embedQuery: vi.fn(async () => {
        throw new Error("voyage down");
      }),
    });
    const { client } = fakeHybridClient({ bm25: new Error("es down") });
    await expect(
      hybridSearchDocuments(hybridQ(), {
        client,
        embeddingProvider: provider,
      })
    ).rejects.toMatchObject({ code: "SEARCH_UNAVAILABLE", statusCode: 503 });
  });

  it("BM25 failure rejects with SEARCH_UNAVAILABLE while embed is slow", async () => {
    // embed stays pending long after BM25 rejects; allSettled must still
    // resolve the function without an unhandled rejection.
    const provider = fakeProvider({
      embedQuery: vi.fn(
        async () =>
          new Promise<number[]>((resolve) =>
            setTimeout(() => resolve(Array.from({ length: DIMS }, () => 0.1)), 25)
          )
      ),
    });
    const { client } = fakeHybridClient({
      bm25: new Error("es down"),
      knn: { hits: { total: 0, hits: [] } },
    });
    await expect(
      hybridSearchDocuments(hybridQ(), {
        client,
        embeddingProvider: provider,
      })
    ).rejects.toMatchObject({ code: "SEARCH_UNAVAILABLE", statusCode: 503 });
  });

  it("kNN branch failure rejects with SEARCH_UNAVAILABLE", async () => {
    const { client } = fakeHybridClient({
      bm25: { hits: { total: 1, hits: [hit("a")] } },
      knn: new Error("knn boom"),
    });
    await expect(
      hybridSearchDocuments(hybridQ(), {
        client,
        embeddingProvider: fakeProvider(),
      })
    ).rejects.toMatchObject({ code: "SEARCH_UNAVAILABLE", statusCode: 503 });
  });

  it("clamps an oversized hybridWindow to MAX_HYBRID_WINDOW", async () => {
    const { client, searchCalls } = fakeHybridClient();
    await hybridSearchDocuments(hybridQ(), {
      client,
      embeddingProvider: fakeProvider(),
      searchConfig: {
        titleBoost: 3,
        contentBoost: 1,
        technologiesBoost: 2,
        hybridWindow: 50_000,
      },
    });
    expect(searchCalls[0]!.size).toBe(1000);
  });

  it("works end-to-end through the deps seam (env provider untouched)", async () => {
    embeddingDeps.provider = fakeProvider();
    try {
      const { client } = fakeHybridClient({
        bm25: { hits: { total: 1, hits: [hit("a")] } },
        countValue: 1,
      });
      const res = await hybridSearchDocuments(hybridQ(), { client });
      expect(res.results[0]!.id).toBe("a");
    } finally {
      delete embeddingDeps.provider;
    }
  });
});
