import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { AppError } from "../src/shared/errors/app-error.js";
import { DocumentModel } from "../src/features/documents/models/document.model.js";
import { documentRepository } from "../src/features/documents/repositories/document.repository.js";
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

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const BASE_DOC: CreateDocumentInput = {
  title: "Node.js Streams Guide",
  url: "https://nodejs.org/docs/streams",
  source: "NodeJS",
  category: "documentation",
  contentType: "markdown",
  technologies: [" NodeJS ", "STREAMS"],
  content: "A guide to the Node.js streams API.",
  contentHash: sha256("streams-content"),
  sourceId: "streams-guide-v1",
  author: "Node.js Contributors",
  publishedAt: new Date("2024-01-15T00:00:00Z"),
};

describe("document creation", () => {
  it("creates a document with all fields and normalizes them", async () => {
    const doc = await documentRepository.create(BASE_DOC);

    expect(doc._id).toBeDefined();
    expect(doc.title).toBe(BASE_DOC.title);
    expect(doc.url).toBe(BASE_DOC.url);
    expect(doc.source).toBe("nodejs"); // lowercased
    expect(doc.category).toBe("documentation");
    expect(doc.contentType).toBe("markdown");
    expect(doc.technologies).toEqual(["nodejs", "streams"]); // normalized
    expect(doc.sourceId).toBe("streams-guide-v1");
    expect(doc.author).toBe("Node.js Contributors");
    expect(doc.publishedAt?.toISOString()).toBe(
      "2024-01-15T00:00:00.000Z"
    );
  });

  it("creates a document with only required fields", async () => {
    const {
      sourceId: _s,
      author: _a,
      publishedAt: _p,
      technologies: _t,
      ...required
    } = BASE_DOC;

    const doc = await documentRepository.create(required);

    expect(doc._id).toBeDefined();
    expect(doc.technologies).toEqual([]);
    expect(doc.sourceId).toBeUndefined();
    expect(doc.author).toBeUndefined();
    expect(doc.publishedAt).toBeUndefined();
  });

  it.each([
    "title",
    "url",
    "source",
    "category",
    "contentType",
    "content",
    "contentHash",
  ] as const)("rejects a document missing %s", async (field) => {
    const input = { ...BASE_DOC, [field]: undefined };

    await expect(documentRepository.create(input)).rejects.toThrow(
      mongoose.Error.ValidationError
    );
  });

  it("rejects an invalid category", async () => {
    await expect(
      documentRepository.create({
        ...BASE_DOC,
        category: "blog" as never,
      })
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  it("rejects an invalid content type", async () => {
    await expect(
      documentRepository.create({
        ...BASE_DOC,
        contentType: "video" as never,
      })
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  it("rejects a malformed contentHash", async () => {
    await expect(
      documentRepository.create({ ...BASE_DOC, contentHash: "not-sha256" })
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  it("generates timestamps and refreshes updatedAt on write", async () => {
    const doc = await documentRepository.create(BASE_DOC);

    expect(doc.createdAt).toBeInstanceOf(Date);
    expect(doc.updatedAt).toBeInstanceOf(Date);
    expect(doc.createdAt.getTime()).toBe(doc.updatedAt.getTime());

    await new Promise((resolve) => setTimeout(resolve, 10));
    const updated = await documentRepository.updateById(doc._id.toString(), {
      title: "Updated title",
    });

    expect(updated?.updatedAt.getTime()).toBeGreaterThan(
      doc.createdAt.getTime()
    );
  });
});

describe("document repository", () => {
  it("finds a document by id, url, and (source, url)", async () => {
    const doc = await documentRepository.create(BASE_DOC);

    expect((await documentRepository.findById(doc._id.toString()))?.title).toBe(
      BASE_DOC.title
    );
    expect(
      (await documentRepository.findByUrl(BASE_DOC.url))?.contentHash
    ).toBe(BASE_DOC.contentHash);
    expect(
      (await documentRepository.findBySourceUrl("nodejs", BASE_DOC.url))?._id
        .toString()
    ).toBe(doc._id.toString());
    expect(
      await documentRepository.findBySourceUrl("other-source", BASE_DOC.url)
    ).toBeNull();
    expect(await documentRepository.findById(doc._id.toHexString())).not.toBeNull();
  });

  it("updates a document and runs validators", async () => {
    const doc = await documentRepository.create(BASE_DOC);

    const updated = await documentRepository.updateById(doc._id.toString(), {
      title: "  Revised Streams Guide  ",
      technologies: ["NODE", "  Deno "],
    });

    expect(updated?.title).toBe("Revised Streams Guide");
    expect(updated?.technologies).toEqual(["node", "deno"]);

    await expect(
      documentRepository.updateById(doc._id.toString(), {
        category: "nope" as never,
      })
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  it("deletes a document by id", async () => {
    const doc = await documentRepository.create(BASE_DOC);

    const deleted = await documentRepository.deleteById(doc._id.toString());

    expect(deleted?._id.toString()).toBe(doc._id.toString());
    expect(await documentRepository.findById(doc._id.toString())).toBeNull();
    expect(await documentRepository.deleteById(doc._id.toString())).toBeNull();
  });
});

describe("duplicate handling", () => {
  it("rejects the same canonical URL under the same source", async () => {
    await documentRepository.create(BASE_DOC);

    const dup = documentRepository.create({
      ...BASE_DOC,
      sourceId: "different-id",
      contentHash: sha256("different-content"),
    });

    await expect(dup).rejects.toThrow(AppError);
    await expect(dup).rejects.toMatchObject({
      statusCode: 409,
      code: "DOCUMENT_ALREADY_EXISTS",
    });
  });

  it("allows the same URL under a different source", async () => {
    await documentRepository.create(BASE_DOC);

    const mirror = await documentRepository.create({
      ...BASE_DOC,
      source: "mirror",
      sourceId: "streams-guide-v1", // same external id, different source: fine
    });

    expect(mirror._id).toBeDefined();
  });

  it("rejects the same sourceId under the same source", async () => {
    await documentRepository.create(BASE_DOC);

    await expect(
      documentRepository.create({
        ...BASE_DOC,
        url: "https://nodejs.org/docs/other-page",
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "DOCUMENT_ALREADY_EXISTS",
    });
  });

  it("allows multiple documents with the same source and no sourceId", async () => {
    // sourceId is optional; documents without it must not collide on a
    // shared null key in the (source, sourceId) index.
    const { sourceId: _s, ...noSourceId } = BASE_DOC;

    const first = await documentRepository.create({
      ...noSourceId,
      url: "https://nodejs.org/docs/a",
    });
    const second = await documentRepository.create({
      ...noSourceId,
      url: "https://nodejs.org/docs/b",
    });
    const third = await documentRepository.create({
      ...noSourceId,
      url: "https://nodejs.org/docs/c",
    });

    expect(first._id).toBeDefined();
    expect(second._id).toBeDefined();
    expect(third._id).toBeDefined();
  });

  it("allows the same source with different sourceIds", async () => {
    await documentRepository.create(BASE_DOC);

    const other = await documentRepository.create({
      ...BASE_DOC,
      url: "https://nodejs.org/docs/another",
      sourceId: "other-doc-v1",
    });

    expect(other._id).toBeDefined();
  });

  it("mixes documents with and without sourceId under one source", async () => {
    await documentRepository.create(BASE_DOC); // has sourceId

    const { sourceId: _s, ...noSourceId } = BASE_DOC;
    const without = await documentRepository.create({
      ...noSourceId,
      url: "https://nodejs.org/docs/no-id",
    });

    expect(without._id).toBeDefined();
  });

  it("allows identical contentHash across documents (not globally unique)", async () => {
    await documentRepository.create(BASE_DOC);

    const sameContent = await documentRepository.create({
      ...BASE_DOC,
      url: "https://example.com/mirrored-streams",
      sourceId: "mirror-1",
    });

    expect(sameContent.contentHash).toBe(BASE_DOC.contentHash);
  });
});
