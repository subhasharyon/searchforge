import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { DocumentModel } from "../src/features/documents/models/document.model.js";
import { UserModel } from "../src/features/users/models/user.model.js";
import { searchIndexDeps } from "../src/features/search/services/es-client.provider.js";
import { SEARCH_INDEX_ALIAS } from "../src/features/search/services/index-manager.service.js";
import type {
  EsClientLike,
  EsSearchResponse,
  SearchDocument,
} from "../src/features/search/types/search.types.js";
import { startTestDb, stopTestDb } from "./helpers/test-db.js";

let accessToken: string;
let adminToken: string;
const auth = () => ({ Authorization: `Bearer ${accessToken}` });
const adminAuth = () => ({ Authorization: `Bearer ${adminToken}` });

/* Fake ES client capturing calls; search returns a canned hit set. */
const indexedDocs: { id: string; document: SearchDocument }[] = [];
const deletedIds: string[] = [];
const bulkCalls: { index: string; operations: unknown[] }[] = [];

const searchHit: EsSearchResponse = {
  hits: {
    total: { value: 1 },
    hits: [
      {
        _id: "abc",
        _score: 3.5,
        _source: {
          title: "Node.js Streams",
          url: "https://nodejs.org/api/stream.html",
          source: "nodejs",
          category: "documentation",
          contentType: "html",
          technologies: ["nodejs"],
          updatedAt: "2024-06-01T00:00:00.000Z",
        },
        highlight: { content: ["<mark>Streams</mark> are collections"] },
      },
    ],
  },
};

const client: EsClientLike = {
  indices: {
    exists: async () => false,
    create: async (o) => {
      createdIndices.push(o.index);
      return {};
    },
    delete: async () => ({}),
    getAlias: async () => {
      throw Object.assign(new Error("nf"), { statusCode: 404 });
    },
    existsAlias: async () => false,
    updateAliases: async (o) => {
      aliasActions.push(...o.actions);
      return {};
    },
  },
  index: async (o) => {
    indexedDocs.push({ id: o.id, document: o.document });
    return {};
  },
  delete: async (o) => {
    deletedIds.push(o.id);
    return {};
  },
  bulk: async (o) => {
    bulkCalls.push(o);
    return {
      errors: false,
      items: o.operations
        .filter((_, i) => i % 2 === 0)
        .map(() => ({ index: { status: 200 } })),
    };
  },
  search: async () => searchHit,
};

const createdIndices: string[] = [];
const aliasActions: Record<string, unknown>[] = [];

const register = async (email: string): Promise<string> => {
  const res = await request(app).post("/api/v1/auth/register").send({
    name: "Search Tester",
    email,
    password: "password1",
  });
  return res.body.data.tokens.accessToken as string;
};

beforeAll(async () => {
  await startTestDb();
  accessToken = await register("search@example.com");
  adminToken = await register("search-admin@example.com");
  await UserModel.updateOne(
    { email: "search-admin@example.com" },
    { role: "admin" }
  );
});

afterAll(stopTestDb);

beforeEach(async () => {
  await DocumentModel.deleteMany({});
  indexedDocs.length = 0;
  deletedIds.length = 0;
  bulkCalls.length = 0;
  createdIndices.length = 0;
  aliasActions.length = 0;
  searchIndexDeps.client = client;
});

afterAll(() => {
  searchIndexDeps.client = undefined;
});

const docPayload = {
  title: "Node.js Streams",
  url: "https://nodejs.org/api/stream.html",
  source: "nodejs",
  category: "documentation",
  contentType: "html",
  technologies: ["nodejs"],
  content: "Streams are collections of data.",
};

describe("GET /api/v1/search authentication and validation", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/v1/search?q=node");
    expect(res.status).toBe(401);
  });

  it("returns structured results for a valid query", async () => {
    const res = await request(app)
      .get("/api/v1/search?q=streams&category=documentation&limit=10")
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.pagination).toEqual({
      page: 1,
      limit: 10,
      total: 1,
      totalPages: 1,
    });
    const r = res.body.data.results[0];
    expect(r.title).toBe("Node.js Streams");
    expect(r.score).toBe(3.5);
    expect(r.highlights.content[0]).toContain("<mark>");
    expect(r).not.toHaveProperty("_source");
  });

  it("supports the full filter surface", async () => {
    const res = await request(app)
      .get(
        "/api/v1/search?q=node&source=nodejs&technology=nodejs&contentType=html&page=2&limit=5"
      )
      .set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.pagination.page).toBe(2);
    expect(res.body.data.pagination.limit).toBe(5);
  });

  it("rejects unknown query parameters", async () => {
    const res = await request(app)
      .get("/api/v1/search?q=node&bogus=1")
      .set(auth());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects invalid enum, oversized limit and zero page", async () => {
    for (const qs of [
      "category=bogus",
      "contentType=exe",
      "limit=51",
      "limit=0",
      "page=0",
    ]) {
      const res = await request(app)
        .get(`/api/v1/search?${qs}`)
        .set(auth());
      expect(res.status).toBe(400);
    }
  });

  it("rejects paging beyond the result window", async () => {
    const res = await request(app)
      .get("/api/v1/search?page=201&limit=50")
      .set(auth());
    expect(res.status).toBe(400);
  });

  it("applies defaults for an empty query", async () => {
    const res = await request(app).get("/api/v1/search").set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.pagination).toMatchObject({
      page: 1,
      limit: 20,
    });
  });
});

describe("MongoDB to Elasticsearch synchronization", () => {
  it("indexes a document after POST /documents", async () => {
    const res = await request(app)
      .post("/api/v1/documents")
      .set(auth())
      .send(docPayload);

    expect(res.status).toBe(201);
    expect(indexedDocs).toHaveLength(1);
    expect(indexedDocs[0]!.document.title).toBe("Node.js Streams");
    expect(indexedDocs[0]!.document.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(indexedDocs[0]!.id).toBe(res.body.data.document._id);
  });

  it("re-indexes on PATCH /documents/:id", async () => {
    const create = await request(app)
      .post("/api/v1/documents")
      .set(auth())
      .send(docPayload);
    const id = create.body.data.document._id;

    const res = await request(app)
      .patch(`/api/v1/documents/${id}`)
      .set(auth())
      .send({ title: "Updated title" });

    expect(res.status).toBe(200);
    expect(indexedDocs).toHaveLength(2);
    expect(indexedDocs[1]!.id).toBe(id);
    expect(indexedDocs[1]!.document.title).toBe("Updated title");
  });

  it("removes the indexed document on DELETE /documents/:id", async () => {
    const create = await request(app)
      .post("/api/v1/documents")
      .set(auth())
      .send(docPayload);
    const id = create.body.data.document._id;

    const res = await request(app)
      .delete(`/api/v1/documents/${id}`)
      .set(auth());

    expect(res.status).toBe(200);
    expect(deletedIds).toEqual([id]);
  });

  it("indexes through the ingestion pipeline", async () => {
    const res = await request(app)
      .post("/api/v1/documents/ingest")
      .set(auth())
      .send(docPayload);

    expect(res.status).toBe(201);
    expect(indexedDocs).toHaveLength(1);
  });

  it("does not re-index an unchanged re-ingest", async () => {
    await request(app)
      .post("/api/v1/documents/ingest")
      .set(auth())
      .send(docPayload);
    const res = await request(app)
      .post("/api/v1/documents/ingest")
      .set(auth())
      .send(docPayload);

    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe("unchanged");
    // 'unchanged' performs no Mongo write, so no re-index either.
    expect(indexedDocs).toHaveLength(1);
  });

  it("does not fail the Mongo write when Elasticsearch is down", async () => {
    const flakyClient: EsClientLike = {
      ...client,
      index: async () => {
        throw new Error("ES unreachable");
      },
    };
    searchIndexDeps.client = flakyClient;

    const res = await request(app)
      .post("/api/v1/documents")
      .set(auth())
      .send(docPayload);

    // MongoDB remains canonical: the write succeeds despite the ES failure.
    expect(res.status).toBe(201);
    const count = await DocumentModel.countDocuments();
    expect(count).toBe(1);
  });
});

describe("POST /api/v1/search/reindex", () => {
  it("rejects non-admin users", async () => {
    const res = await request(app)
      .post("/api/v1/search/reindex")
      .set(auth());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).post("/api/v1/search/reindex");
    expect(res.status).toBe(401);
  });

  it("rebuilds the index from MongoDB for admins", async () => {
    await request(app)
      .post("/api/v1/documents")
      .set(adminAuth())
      .send(docPayload);
    await request(app)
      .post("/api/v1/documents")
      .set(adminAuth())
      .send({ ...docPayload, url: "https://nodejs.org/api/buffer.html" });

    const res = await request(app)
      .post("/api/v1/search/reindex")
      .set(adminAuth());

    expect(res.status).toBe(200);
    const report = res.body.data.report;
    expect(report.indexed).toBe(2);
    expect(report.failed).toBe(0);
    expect(report.toIndex).toBe("searchforge-documents-v1");
    // Both documents went through bulk into the new concrete index.
    expect(bulkCalls).toHaveLength(1);
    expect(bulkCalls[0]!.index).toBe("searchforge-documents-v1");
    // Alias swapped to the rebuilt index.
    expect(aliasActions).toContainEqual({
      add: { index: "searchforge-documents-v1", alias: SEARCH_INDEX_ALIAS },
    });
  });
});
