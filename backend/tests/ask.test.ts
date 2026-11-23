import { afterEach, describe, expect, it, vi } from "vitest";
import {
  askQuestion,
  RAG_TOP_K,
} from "../src/features/ask/services/ask.service.js";
import type {
  LlmAnswer,
  LlmProvider,
} from "../src/features/ask/services/llm.provider.js";
import { LlmError } from "../src/features/ask/services/llm.provider.js";
import type { EmbeddingProvider } from "../src/features/search/services/embedding.provider.js";
import type {
  EsClientLike,
  EsHit,
  EsSearchResponse,
} from "../src/features/search/types/search.types.js";
import type { AskQuery } from "../src/features/ask/types/ask.types.js";

const embeddingProvider: EmbeddingProvider = {
  model: "test-model",
  dims: 3,
  embedDocuments: async (texts) => texts.map(() => [0.1, 0.2, 0.3]),
  embedQuery: vi.fn(async () => [0.1, 0.2, 0.3]),
};

const hit = (id: string, parentId: string): EsHit => ({
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
    heading: "Section",
    content: `passage content for ${id}`,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
});

const response = (...hits: EsHit[]): EsSearchResponse => ({
  hits: { total: hits.length, hits },
});

const makeClient = (bm25: EsSearchResponse, countValue = 0): EsClientLike => ({
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
  count: async () => ({ count: countValue }),
  search: async (a) => {
    if (a.knn) {
      return response(); // empty vector leg - BM25 drives the fixtures
    }
    return bm25;
  },
});

const answer = (overrides: Partial<LlmAnswer> = {}): LlmAnswer => ({
  status: "answered",
  answer: "Streams use backpressure to bound memory.",
  citationRefs: [1],
  promptTokens: 100,
  outputTokens: 40,
  ...overrides,
});

const makeProvider = (
  impl?: LlmProvider["generateAnswer"]
): { provider: LlmProvider; generateAnswer: ReturnType<typeof vi.fn> } => {
  const generateAnswer = vi.fn(impl ?? (async () => answer()));
  return { provider: { model: "claude-haiku-test", generateAnswer }, generateAnswer };
};

const ask = (overrides: Partial<AskQuery> = {}): AskQuery => ({
  question: "how do streams handle backpressure?",
  ...overrides,
});

describe("askQuestion", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails closed with 503 when no LLM provider is configured", async () => {
    await expect(
      askQuestion(ask(), { llmProvider: null, client: makeClient(response()) })
    ).rejects.toMatchObject({ statusCode: 503, code: "LLM_UNAVAILABLE" });
  });

  it("returns insufficient_evidence without calling the LLM on empty retrieval", async () => {
    const { provider, generateAnswer } = makeProvider();
    const out = await askQuestion(ask(), {
      client: makeClient(response()),
      embeddingProvider,
      llmProvider: provider,
    });

    expect(out.status).toBe("insufficient_evidence");
    expect(out.sources).toHaveLength(0);
    expect(out.citations).toHaveLength(0);
    expect(out.meta.generationMs).toBe(0);
    expect(generateAnswer).not.toHaveBeenCalled();
  });

  it("retrieves passages, generates, and validates citations", async () => {
    const client = makeClient(
      response(hit("docA:0", "docA"), hit("docB:0", "docB"))
    );
    const { provider, generateAnswer } = makeProvider(async () =>
      answer({ citationRefs: [1, 2] })
    );

    const out = await askQuestion(ask(), {
      client,
      embeddingProvider,
      llmProvider: provider,
    });

    expect(generateAnswer).toHaveBeenCalledOnce();
    const llmRequest = generateAnswer.mock.calls[0]![0];
    expect(llmRequest.question).toBe(ask().question);
    expect(llmRequest.context).toContain("[DOC 1]");
    expect(llmRequest.context).toContain("[DOC 2]");

    expect(out.status).toBe("answered");
    expect(out.citations).toHaveLength(2);
    expect(out.citations.map((c) => c.documentId).sort()).toEqual([
      "docA",
      "docB",
    ]);
    expect(out.sources).toHaveLength(2);
    expect(out.meta.model).toBe("claude-haiku-test");
    expect(out.meta.retrievalMode).toBe("passage");
    expect(out.meta.promptTokens).toBe(100);
  });

  it("caps sources at RAG_TOP_K passages", async () => {
    // The candidate window stays at PASSAGE_WINDOW_SIZE; RAG_TOP_K bounds
    // the page slice that becomes context + sources.
    const hits = Array.from({ length: RAG_TOP_K + 4 }, (_, i) =>
      hit(`d${i}:0`, `d${i}`)
    );
    const client = makeClient(response(...hits));
    const { provider } = makeProvider(async () =>
      answer({ citationRefs: [] })
    );

    const out = await askQuestion(ask(), {
      client,
      embeddingProvider,
      llmProvider: provider,
    });

    expect(out.sources).toHaveLength(RAG_TOP_K);
    expect(out.citations).toHaveLength(0);
  });

  it("drops citation refs that do not resolve to a retrieved passage", async () => {
    const client = makeClient(response(hit("docA:0", "docA")));
    const { provider } = makeProvider(async () =>
      answer({ citationRefs: [1, 7, 99] })
    );

    const out = await askQuestion(ask(), {
      client,
      embeddingProvider,
      llmProvider: provider,
    });

    expect(out.citations).toHaveLength(1);
    expect(out.citations[0]!.documentId).toBe("docA");
  });

  it("dedupes citations that point at the same passage", async () => {
    const client = makeClient(response(hit("docA:0", "docA")));
    const { provider } = makeProvider(async () =>
      answer({ citationRefs: [1, 1, 1] })
    );
    const out = await askQuestion(ask(), {
      client,
      embeddingProvider,
      llmProvider: provider,
    });
    expect(out.citations).toHaveLength(1);
  });

  it("propagates insufficient_evidence from the model", async () => {
    const client = makeClient(response(hit("docA:0", "docA")));
    const { provider } = makeProvider(async () =>
      answer({ status: "insufficient_evidence", citationRefs: [] })
    );
    const out = await askQuestion(ask(), {
      client,
      embeddingProvider,
      llmProvider: provider,
    });
    expect(out.status).toBe("insufficient_evidence");
    expect(out.citations).toHaveLength(0);
  });

  it("propagates LlmError unchanged", async () => {
    const client = makeClient(response(hit("docA:0", "docA")));
    const { provider } = makeProvider(async () => {
      throw new LlmError("rate limited", "LLM_RATE_LIMITED", true);
    });
    await expect(
      askQuestion(ask(), { client, embeddingProvider, llmProvider: provider })
    ).rejects.toMatchObject({ code: "LLM_RATE_LIMITED", statusCode: 503 });
  });

  it("maps unexpected provider failures to 503 LLM_UNAVAILABLE", async () => {
    const client = makeClient(response(hit("docA:0", "docA")));
    const { provider } = makeProvider(async () => {
      throw new Error("socket hangup");
    });
    await expect(
      askQuestion(ask(), { client, embeddingProvider, llmProvider: provider })
    ).rejects.toMatchObject({ code: "LLM_UNAVAILABLE", statusCode: 503 });
  });

  it("propagates retrieval failures as SEARCH_UNAVAILABLE-family errors", async () => {
    const client = makeClient(response());
    client.search = async () => {
      throw Object.assign(new Error("es down"), { statusCode: 500 });
    };
    await expect(
      askQuestion(ask(), {
        client,
        embeddingProvider,
        llmProvider: makeProvider().provider,
      })
    ).rejects.toMatchObject({ statusCode: 503 });
  });
});
