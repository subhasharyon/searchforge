import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { AppError } from "../src/shared/errors/app-error.js";
import { DocumentModel } from "../src/features/documents/models/document.model.js";
import { documentRepository } from "../src/features/documents/repositories/document.repository.js";
import {
  createDocument,
  deleteDocument,
  getDocumentById,
  getDocumentBySourceUrl,
  updateDocument,
} from "../src/features/documents/services/document.service.js";
import type { CreateDocumentInput } from "../src/features/documents/types/document.types.js";
import { startTestDb, stopTestDb } from "./helpers/test-db.js";

beforeAll(async () => {
  await startTestDb();
  await DocumentModel.ensureIndexes();
});

afterAll(stopTestDb);

beforeEach(async () => {
  await DocumentModel.deleteMany({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const BASE_DOC: CreateDocumentInput = {
  title: "Node.js Streams Guide",
  url: "https://nodejs.org/docs/streams",
  source: "nodejs",
  category: "documentation",
  contentType: "markdown",
  technologies: ["nodejs"],
  content: "A guide to the Node.js streams API.",
  contentHash: sha256("streams-content"),
  sourceId: "streams-guide-v1",
  author: "Node.js Contributors",
  publishedAt: new Date("2024-01-15T00:00:00Z"),
};

const NONEXISTENT_ID = new mongoose.Types.ObjectId().toString();

const expectAppError = async (
  promise: Promise<unknown>,
  statusCode: number,
  code: string
): Promise<void> => {
  await expect(promise).rejects.toThrow(AppError);
  await expect(promise).rejects.toMatchObject({ statusCode, code });
};

describe("createDocument", () => {
  it("creates and persists a document", async () => {
    const doc = await createDocument(BASE_DOC);

    expect(doc._id).toBeDefined();
    expect(doc.title).toBe(BASE_DOC.title);
    expect(await DocumentModel.findById(doc._id)).not.toBeNull();
  });

  it("rejects a duplicate document identity", async () => {
    await createDocument(BASE_DOC);

    await expectAppError(
      createDocument(BASE_DOC),
      409,
      "DOCUMENT_ALREADY_EXISTS"
    );
  });
});

describe("getDocumentById", () => {
  it("returns the document", async () => {
    const doc = await createDocument(BASE_DOC);

    const found = await getDocumentById(doc._id.toString());

    expect(found._id.toString()).toBe(doc._id.toString());
  });

  it("throws DOCUMENT_NOT_FOUND for a missing document", async () => {
    await expectAppError(getDocumentById(NONEXISTENT_ID), 404, "DOCUMENT_NOT_FOUND");
  });

  it("throws VALIDATION_ERROR for a malformed id", async () => {
    await expectAppError(getDocumentById("not-an-objectid"), 400, "VALIDATION_ERROR");
  });
});

describe("getDocumentBySourceUrl", () => {
  it("returns the document for source + url", async () => {
    const doc = await createDocument(BASE_DOC);

    // source lookup normalizes case
    const found = await getDocumentBySourceUrl("NodeJS", BASE_DOC.url);

    expect(found._id.toString()).toBe(doc._id.toString());
  });

  it("throws DOCUMENT_NOT_FOUND for the wrong source", async () => {
    await createDocument(BASE_DOC);

    await expectAppError(
      getDocumentBySourceUrl("other-source", BASE_DOC.url),
      404,
      "DOCUMENT_NOT_FOUND"
    );
  });

  it("throws VALIDATION_ERROR for empty inputs", async () => {
    await expectAppError(getDocumentBySourceUrl("", BASE_DOC.url), 400, "VALIDATION_ERROR");
    await expectAppError(getDocumentBySourceUrl("nodejs", "  "), 400, "VALIDATION_ERROR");
  });
});

describe("updateDocument", () => {
  it("updates and returns the document", async () => {
    const doc = await createDocument(BASE_DOC);

    const updated = await updateDocument(doc._id.toString(), {
      title: "Revised Streams Guide",
      technologies: ["Deno"],
    });

    expect(updated.title).toBe("Revised Streams Guide");
    expect(updated.technologies).toEqual(["deno"]);
  });

  it("throws DOCUMENT_NOT_FOUND for a missing document", async () => {
    await expectAppError(
      updateDocument(NONEXISTENT_ID, { title: "x" }),
      404,
      "DOCUMENT_NOT_FOUND"
    );
  });

  it("throws VALIDATION_ERROR for a malformed id", async () => {
    await expectAppError(
      updateDocument("bad-id", { title: "x" }),
      400,
      "VALIDATION_ERROR"
    );
  });

  it("rejects an update that collides with another document's identity", async () => {
    const a = await createDocument(BASE_DOC);
    const b = await createDocument({
      ...BASE_DOC,
      url: "https://nodejs.org/docs/other",
      sourceId: "other-doc",
    });

    await expectAppError(
      updateDocument(b._id.toString(), { url: a.url }),
      409,
      "DOCUMENT_ALREADY_EXISTS"
    );
  });
});

describe("deleteDocument", () => {
  it("deletes and returns the document", async () => {
    const doc = await createDocument(BASE_DOC);

    const deleted = await deleteDocument(doc._id.toString());

    expect(deleted._id.toString()).toBe(doc._id.toString());
    await expectAppError(
      getDocumentById(doc._id.toString()),
      404,
      "DOCUMENT_NOT_FOUND"
    );
  });

  it("throws DOCUMENT_NOT_FOUND for a missing document", async () => {
    await expectAppError(deleteDocument(NONEXISTENT_ID), 404, "DOCUMENT_NOT_FOUND");
  });
});

describe("error propagation", () => {
  it("propagates repository failures without masking them as not-found", async () => {
    const dbError = new Error("connection lost");
    vi.spyOn(documentRepository, "findById").mockRejectedValueOnce(dbError);

    const doc = await createDocument(BASE_DOC);

    await expect(getDocumentById(doc._id.toString())).rejects.toThrow(
      "connection lost"
    );
    await expect(
      getDocumentById(doc._id.toString()).catch((e: unknown) => e)
    ).resolves.not.toBeInstanceOf(AppError);
  });
});
