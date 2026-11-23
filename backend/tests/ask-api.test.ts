import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { UserModel } from "../src/features/users/models/user.model.js";
import { searchIndexDeps } from "../src/features/search/services/es-client.provider.js";
import { embeddingDeps } from "../src/features/search/services/embedding.provider.js";
import { llmDeps } from "../src/features/ask/services/llm.provider.js";
import type {
  EsClientLike,
  EsSearchResponse,
} from "../src/features/search/types/search.types.js";
import { startTestDb, stopTestDb } from "./helpers/test-db.js";

let accessToken: string;
const auth = () => ({ Authorization: `Bearer ${accessToken}` });

const chunkHit: EsSearchResponse = {
  hits: {
    total: { value: 1 },
    hits: [
      {
        _id: "doc1:0",
        _source: {
          parent_document_id: "doc1",
          chunk_index: 0,
          title: "Node.js Streams",
          url: "https://nodejs.org/api/stream.html",
          source: "nodejs",
          category: "documentation",
          contentType: "html",
          technologies: ["nodejs"],
          heading: "Backpressure",
          content: "Streams handle backpressure via the highWaterMark.",
          updatedAt: "2024-06-01T00:00:00.000Z",
        },
      },
    ],
  },
};

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
  count: async () => ({ count: 1 }),
  search: async (a) =>
    a.knn ? { hits: { total: 0, hits: [] } } : chunkHit,
};

const fakeProvider = {
  model: "claude-haiku-test",
  generateAnswer: async () => ({
    status: "answered" as const,
    answer: "Use the highWaterMark option to bound the buffer.",
    citationRefs: [1],
    promptTokens: 50,
    outputTokens: 20,
  }),
};

beforeAll(async () => {
  await startTestDb();
  searchIndexDeps.client = client;
  embeddingDeps.provider = {
    model: "test",
    dims: 3,
    embedDocuments: async (t) => t.map(() => [0.1]),
    embedQuery: async () => [0.1],
  };
  llmDeps.provider = fakeProvider;

  await request(app).post("/api/v1/auth/register").send({
    name: "Asker",
    email: "asker@example.com",
    password: "password123",
  });
  const user = await UserModel.findOne({ email: "asker@example.com" });
  expect(user).not.toBeNull();
  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: "asker@example.com", password: "password123" });
  accessToken = login.body.data.tokens.accessToken;
});

afterAll(async () => {
  searchIndexDeps.client = undefined;
  embeddingDeps.provider = undefined;
  llmDeps.provider = undefined;
  await stopTestDb();
});

describe("POST /api/v1/ask", () => {
  it("requires authentication", async () => {
    const res = await request(app)
      .post("/api/v1/ask")
      .send({ question: "q" });
    expect(res.status).toBe(401);
  });

  it("rejects a missing question with 400", async () => {
    const res = await request(app)
      .post("/api/v1/ask")
      .set(auth())
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an oversized question with 400", async () => {
    const res = await request(app)
      .post("/api/v1/ask")
      .set(auth())
      .send({ question: "x".repeat(501) });
    expect(res.status).toBe(400);
  });

  it("rejects unknown fields with 400", async () => {
    const res = await request(app)
      .post("/api/v1/ask")
      .set(auth())
      .send({ question: "q", sneaky: true });
    expect(res.status).toBe(400);
  });

  it("answers with validated citations and sources", async () => {
    const res = await request(app)
      .post("/api/v1/ask")
      .set(auth())
      .send({ question: "how does backpressure work?" });

    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(data.status).toBe("answered");
    expect(data.answer).toContain("highWaterMark");
    expect(data.citations).toHaveLength(1);
    expect(data.citations[0].documentId).toBe("doc1");
    expect(data.citations[0].url).toBe("https://nodejs.org/api/stream.html");
    expect(data.sources).toHaveLength(1);
    expect(data.meta.model).toBe("claude-haiku-test");
    expect(data.meta.retrievalMode).toBe("passage");
  });
});
