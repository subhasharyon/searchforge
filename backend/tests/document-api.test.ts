import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import request from "supertest";
import app from "../src/app.js";
import { DocumentModel } from "../src/features/documents/models/document.model.js";
import { startTestDb, stopTestDb } from "./helpers/test-db.js";

const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const VALID_DOC = {
  title: "Node.js Streams Guide",
  url: "https://nodejs.org/api/stream.html",
  source: "nodejs",
  category: "documentation",
  contentType: "markdown",
  technologies: ["Node.js", " streams "],
  content: "Streams let you read data continuously.",
  author: "Node.js Contributors",
  sourceId: "doc-stream-1",
  publishedAt: "2024-01-15T00:00:00.000Z",
};

let accessToken: string;

const authHeader = () => ({ Authorization: `Bearer ${accessToken}` });

const createDoc = (overrides: Record<string, unknown> = {}) =>
  request(app)
    .post("/api/v1/documents")
    .set(authHeader())
    .send({ ...VALID_DOC, ...overrides });

beforeAll(async () => {
  await startTestDb();
  await DocumentModel.ensureIndexes();

  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      name: "Docs Tester",
      email: "docs@example.com",
      password: "password1",
    });
  accessToken = res.body.data.tokens.accessToken;
});

beforeEach(async () => {
  await DocumentModel.deleteMany({});
});

afterAll(stopTestDb);

describe("POST /api/v1/documents", () => {
  it("creates a document, normalizes content and derives contentHash", async () => {
    const content = "a\r\nb  \r\n\r\n\r\nc d";
    const res = await createDoc({ content });

    expect(res.status).toBe(201);
    const { document } = res.body.data;
    expect(document.title).toBe(VALID_DOC.title);
    expect(document.url).toBe(VALID_DOC.url);
    expect(document.source).toBe("nodejs");
    expect(document.category).toBe("documentation");
    expect(document.technologies).toEqual(["node.js", "streams"]);
    expect(document.author).toBe("Node.js Contributors");
    expect(document.sourceId).toBe("doc-stream-1");
    expect(document.createdAt).toBeTypeOf("string");
    expect(document).not.toHaveProperty("__v");

    // Content normalized (CRLF, trailing ws, blank lines, NBSP) and the hash
    // is computed server-side from the normalized text.
    const normalized = "a\nb\n\nc d";
    expect(document.content).toBe(normalized);
    expect(document.contentHash).toBe(sha256(normalized));
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).post("/api/v1/documents").send(VALID_DOC);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it.each([
    ["missing title", { title: undefined }],
    ["invalid url", { url: "not-a-url" }],
    ["non-http url", { url: "ftp://example.com/doc" }],
    ["invalid category", { category: "news" }],
    ["invalid contentType", { contentType: "video" }],
    ["empty source", { source: " " }],
    ["empty technologies entry", { technologies: ["valid", " "] }],
  ])("returns 400 for %s", async (_label, overrides) => {
    const res = await createDoc(overrides);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a client-supplied contentHash (server-derived field)", async () => {
    const res = await createDoc({ contentHash: sha256("forged") });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 409 on duplicate source+url identity", async () => {
    await createDoc();
    const res = await createDoc({ title: "Different title" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DOCUMENT_ALREADY_EXISTS");
  });
});

describe("GET /api/v1/documents/:id", () => {
  it("returns the document", async () => {
    const created = (await createDoc()).body.data.document;

    const res = await request(app)
      .get(`/api/v1/documents/${created._id}`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.document._id).toBe(created._id);
  });

  it("returns 400 for a malformed id", async () => {
    const res = await request(app)
      .get("/api/v1/documents/not-an-objectid")
      .set(authHeader());

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for a missing document", async () => {
    const res = await request(app)
      .get("/api/v1/documents/65f1a2b3c4d5e6f7a8b9c0d1")
      .set(authHeader());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("DOCUMENT_NOT_FOUND");
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get(
      "/api/v1/documents/65f1a2b3c4d5e6f7a8b9c0d1"
    );

    expect(res.status).toBe(401);
  });
});

describe("GET /api/v1/documents/lookup", () => {
  it("resolves a document by source + url", async () => {
    await createDoc();

    const res = await request(app)
      .get("/api/v1/documents/lookup")
      .query({ source: "NODEJS", url: VALID_DOC.url })
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.document.url).toBe(VALID_DOC.url);
  });

  it("returns 400 when query parameters are missing or invalid", async () => {
    const missing = await request(app)
      .get("/api/v1/documents/lookup")
      .query({ source: "nodejs" })
      .set(authHeader());
    expect(missing.status).toBe(400);

    const badUrl = await request(app)
      .get("/api/v1/documents/lookup")
      .query({ source: "nodejs", url: "not-a-url" })
      .set(authHeader());
    expect(badUrl.status).toBe(400);
  });

  it("returns 404 when no document matches", async () => {
    const res = await request(app)
      .get("/api/v1/documents/lookup")
      .query({ source: "nodejs", url: "https://example.com/absent" })
      .set(authHeader());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("DOCUMENT_NOT_FOUND");
  });
});

describe("PATCH /api/v1/documents/:id", () => {
  it("updates mutable fields", async () => {
    const created = (await createDoc()).body.data.document;

    const res = await request(app)
      .patch(`/api/v1/documents/${created._id}`)
      .set(authHeader())
      .send({ title: "Updated title", technologies: ["streams"] });

    expect(res.status).toBe(200);
    expect(res.body.data.document.title).toBe("Updated title");
    expect(res.body.data.document.technologies).toEqual(["streams"]);
    expect(res.body.data.document.url).toBe(VALID_DOC.url);
  });

  it("renormalizes content and recomputes contentHash on content update", async () => {
    const created = (await createDoc()).body.data.document;

    const res = await request(app)
      .patch(`/api/v1/documents/${created._id}`)
      .set(authHeader())
      .send({ content: "new\r\n\r\n\r\ncontent  " });

    const normalized = "new\n\ncontent";
    expect(res.status).toBe(200);
    expect(res.body.data.document.content).toBe(normalized);
    expect(res.body.data.document.contentHash).toBe(sha256(normalized));
    expect(res.body.data.document.contentHash).not.toBe(created.contentHash);
  });

  it("rejects an empty update payload", async () => {
    const created = (await createDoc()).body.data.document;

    const res = await request(app)
      .patch(`/api/v1/documents/${created._id}`)
      .set(authHeader())
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects attempts to mutate identity fields", async () => {
    const created = (await createDoc()).body.data.document;

    const res = await request(app)
      .patch(`/api/v1/documents/${created._id}`)
      .set(authHeader())
      .send({ source: "evil", url: "https://evil.example.com", title: "x" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for a missing document", async () => {
    const res = await request(app)
      .patch("/api/v1/documents/65f1a2b3c4d5e6f7a8b9c0d1")
      .set(authHeader())
      .send({ title: "Updated" });

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/v1/documents/:id", () => {
  it("deletes the document and then returns 404", async () => {
    const created = (await createDoc()).body.data.document;

    const res = await request(app)
      .delete(`/api/v1/documents/${created._id}`)
      .set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Document deleted");

    const gone = await request(app)
      .delete(`/api/v1/documents/${created._id}`)
      .set(authHeader());
    expect(gone.status).toBe(404);
  });
});

describe("POST /api/v1/documents/ingest", () => {
  it("creates on first ingest and reports 'created'", async () => {
    const res = await request(app)
      .post("/api/v1/documents/ingest")
      .set(authHeader())
      .send(VALID_DOC);

    expect(res.status).toBe(201);
    expect(res.body.data.outcome).toBe("created");
    expect(res.body.data.document.url).toBe(VALID_DOC.url);
  });

  it("reports 'unchanged' when re-ingesting identical content", async () => {
    const first = await request(app)
      .post("/api/v1/documents/ingest")
      .set(authHeader())
      .send(VALID_DOC);
    const second = await request(app)
      .post("/api/v1/documents/ingest")
      .set(authHeader())
      .send(VALID_DOC);

    expect(second.status).toBe(200);
    expect(second.body.data.outcome).toBe("unchanged");
    expect(second.body.data.document._id).toBe(first.body.data.document._id);
    expect(await DocumentModel.countDocuments()).toBe(1);
  });

  it("reports 'updated' when content changed", async () => {
    await request(app)
      .post("/api/v1/documents/ingest")
      .set(authHeader())
      .send(VALID_DOC);

    const res = await request(app)
      .post("/api/v1/documents/ingest")
      .set(authHeader())
      .send({ ...VALID_DOC, content: "completely rewritten body" });

    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe("updated");
    expect(res.body.data.document.content).toBe("completely rewritten body");
    expect(await DocumentModel.countDocuments()).toBe(1);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app)
      .post("/api/v1/documents/ingest")
      .send(VALID_DOC);

    expect(res.status).toBe(401);
  });
});
