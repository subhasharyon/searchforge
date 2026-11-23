import { describe, expect, it, vi } from "vitest";
import {
  removeChunksFromIndex,
  removeDocumentFromIndex,
  syncChunksToIndex,
  syncDocumentToIndex,
} from "../src/features/search/services/indexing.service.js";
import type { DocumentDocument } from "../src/features/documents/repositories/document.repository.js";
import type { EmbeddingProvider } from "../src/features/search/services/embedding.provider.js";
import type { EsClientLike } from "../src/features/search/types/search.types.js";

const CHUNK_ALIAS = "searchforge-chunks";

const fakeDoc = (content: string): DocumentDocument =>
  ({
    _id: { toString: () => "doc-1" },
    title: "Test doc",
    url: "https://example.com/doc",
    source: "example",
    category: "documentation",
    contentType: "markdown",
    technologies: ["nodejs"],
    content,
    contentHash: "a".repeat(64),
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-02"),
    save: vi.fn(async () => undefined),
  }) as unknown as DocumentDocument;

const provider: EmbeddingProvider = {
  model: "test-model",
  dims: 3,
  embedDocuments: vi.fn(async (texts) => texts.map(() => [0.1, 0.2, 0.3])),
  embedQuery: vi.fn(async () => [0.1, 0.2, 0.3]),
};

const makeClient = (
  opts: { deleteByQueryError?: Error; bulkError?: Error } = {}
) => {
  const deleteByQueryCalls: { index: string; query?: unknown }[] = [];
  const bulkCalls: { index: string; operations: unknown[] }[] = [];
  const indexCalls: { index: string; id: string }[] = [];
  const deleteCalls: { index: string; id: string }[] = [];
  const client: EsClientLike = {
    indices: {
      exists: async () => true,
      create: async () => ({}),
      delete: async () => ({}),
      getAlias: async () => ({}),
      existsAlias: async () => true,
      updateAliases: async () => ({}),
    },
    index: async (o) => {
      indexCalls.push(o);
      return {};
    },
    delete: async (o) => {
      deleteCalls.push(o);
      return {};
    },
    deleteByQuery: async (o) => {
      if (opts.deleteByQueryError) {
        throw opts.deleteByQueryError;
      }
      deleteByQueryCalls.push(o);
      return { deleted: 1 };
    },
    bulk: async (o) => {
      if (opts.bulkError) {
        throw opts.bulkError;
      }
      bulkCalls.push(o);
      return { errors: false, items: [] };
    },
    count: async () => ({ count: 0 }),
    search: async () => ({ hits: { total: 0, hits: [] } }),
  };
  return { client, deleteByQueryCalls, bulkCalls, indexCalls, deleteCalls };
};

const indexNotFound = (): Error =>
  Object.assign(new Error("missing"), {
    body: { error: { type: "index_not_found_exception" } },
  });

describe("syncChunksToIndex", () => {
  it("replaces the chunk set: delete-by-parent then deterministic bulk ids", async () => {
    const { client, deleteByQueryCalls, bulkCalls } = makeClient();
    const doc = fakeDoc("## A\nfirst section\n\n## B\nsecond section");

    await syncChunksToIndex(doc, { client, embeddingProvider: provider });

    expect(deleteByQueryCalls).toEqual([
      {
        index: CHUNK_ALIAS,
        query: { term: { parent_document_id: "doc-1" } },
      },
    ]);
    expect(bulkCalls).toHaveLength(1);
    expect(bulkCalls[0]!.index).toBe(CHUNK_ALIAS);

    const ops = bulkCalls[0]!.operations as Record<string, unknown>[];
    const actionIds = ops
      .filter((_, i) => i % 2 === 0)
      .map((o) => (o.index as { _id: string })._id);
    expect(actionIds).toEqual(["doc-1:0", "doc-1:1"]);

    const firstDoc = ops[1]!;
    expect(firstDoc.parent_document_id).toBe("doc-1");
    expect(firstDoc.heading).toBe("A");
    expect(firstDoc.content_vector).toEqual([0.1, 0.2, 0.3]);
    expect(firstDoc.embeddingModel).toBe("test-model");
    expect(firstDoc.embeddedContentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("embeds all chunks in a single batch call with heading context", async () => {
    const { client } = makeClient();
    await syncChunksToIndex(fakeDoc("## Sec\nbody text"), {
      client,
      embeddingProvider: provider,
    });
    expect(provider.embedDocuments).toHaveBeenCalledTimes(1);
    const inputs = vi.mocked(provider.embedDocuments).mock.calls[0]![0];
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!).toContain("Test doc");
    expect(inputs[0]!).toContain("Sec");
    expect(inputs[0]!).toContain("body text");
  });

  it("indexes chunks without vectors when embedding fails", async () => {
    const { client, bulkCalls } = makeClient();
    const broken: EmbeddingProvider = {
      ...provider,
      embedDocuments: vi.fn(async () => {
        throw new Error("voyage 429");
      }),
    };
    await syncChunksToIndex(fakeDoc("plain content"), {
      client,
      embeddingProvider: broken,
    });
    const chunkDoc = (
      bulkCalls[0]!.operations as Record<string, unknown>[]
    )[1]!;
    expect(chunkDoc.content).toBe("plain content");
    expect(chunkDoc.content_vector).toBeUndefined();
    expect(chunkDoc.embeddedContentHash).toBeUndefined();
  });

  it("indexes chunks without vectors when no provider is configured", async () => {
    const { client, bulkCalls } = makeClient();
    await syncChunksToIndex(fakeDoc("plain content"), {
      client,
      embeddingProvider: null,
    });
    const chunkDoc = (
      bulkCalls[0]!.operations as Record<string, unknown>[]
    )[1]!;
    expect(chunkDoc.content_vector).toBeUndefined();
  });

  it("does not throw when the chunk index is missing", async () => {
    const { client } = makeClient({ deleteByQueryError: indexNotFound() });
    await expect(
      syncChunksToIndex(fakeDoc("content"), {
        client,
        embeddingProvider: provider,
      })
    ).resolves.toBeUndefined();
  });

  it("propagates non-404 bulk/delete failures", async () => {
    const { client } = makeClient({ bulkError: new Error("cluster red") });
    await expect(
      syncChunksToIndex(fakeDoc("content"), {
        client,
        embeddingProvider: provider,
      })
    ).rejects.toThrow("cluster red");
  });

  it("skips chunking for empty content", async () => {
    const { client, deleteByQueryCalls, bulkCalls } = makeClient();
    await syncChunksToIndex(fakeDoc("   "), {
      client,
      embeddingProvider: provider,
    });
    expect(deleteByQueryCalls).toHaveLength(0);
    expect(bulkCalls).toHaveLength(0);
  });
});

describe("removeChunksFromIndex", () => {
  it("deletes by parent_document_id", async () => {
    const { client, deleteByQueryCalls } = makeClient();
    await removeChunksFromIndex("doc-9", { client });
    expect(deleteByQueryCalls).toEqual([
      {
        index: CHUNK_ALIAS,
        query: { term: { parent_document_id: "doc-9" } },
      },
    ]);
  });

  it("swallows a missing chunk index", async () => {
    const { client } = makeClient({ deleteByQueryError: indexNotFound() });
    await expect(
      removeChunksFromIndex("doc-9", { client })
    ).resolves.toBeUndefined();
  });

  it("rethrows other delete failures", async () => {
    const { client } = makeClient({
      deleteByQueryError: new Error("timeout"),
    });
    await expect(
      removeChunksFromIndex("doc-9", { client })
    ).rejects.toThrow("timeout");
  });
});

describe("write-path wiring", () => {
  it("syncDocumentToIndex indexes the doc then syncs chunks", async () => {
    const { client, indexCalls, bulkCalls } = makeClient();
    await syncDocumentToIndex(fakeDoc("## H\nbody"), {
      client,
      embeddingProvider: provider,
    });
    expect(indexCalls).toHaveLength(1);
    expect(indexCalls[0]!.index).toBe("searchforge-documents");
    expect(bulkCalls).toHaveLength(1);
  });

  it("a chunk-sync failure does not undo document indexing", async () => {
    const { client, indexCalls } = makeClient({
      bulkError: new Error("chunk boom"),
    });
    await expect(
      syncDocumentToIndex(fakeDoc("content"), {
        client,
        embeddingProvider: provider,
      })
    ).resolves.toBeUndefined();
    expect(indexCalls).toHaveLength(1);
  });

  it("removeDocumentFromIndex deletes the doc and its chunks", async () => {
    const { client, deleteCalls, deleteByQueryCalls } = makeClient();
    await removeDocumentFromIndex("doc-5", { client });
    expect(deleteCalls).toEqual([
      { index: "searchforge-documents", id: "doc-5" },
    ]);
    expect(deleteByQueryCalls).toEqual([
      {
        index: CHUNK_ALIAS,
        query: { term: { parent_document_id: "doc-5" } },
      },
    ]);
  });
});
