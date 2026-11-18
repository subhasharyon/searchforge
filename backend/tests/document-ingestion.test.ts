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
import { AppError } from "../src/shared/errors/app-error.js";
import { DocumentModel } from "../src/features/documents/models/document.model.js";
import { documentRepository } from "../src/features/documents/repositories/document.repository.js";
import {
  hashContent,
  ingestDocument,
  normalizeContent,
} from "../src/features/documents/services/ingestion.service.js";
import type { IngestDocumentInput } from "../src/features/documents/types/document.types.js";
import { startTestDb, stopTestDb } from "./helpers/test-db.js";

const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const input = (overrides: Partial<IngestDocumentInput> = {}): IngestDocumentInput => ({
  title: "Streams",
  url: "https://nodejs.org/api/stream.html",
  source: "nodejs",
  category: "documentation",
  contentType: "markdown",
  content: "Stream API content",
  ...overrides,
});

beforeAll(async () => {
  await startTestDb();
  await DocumentModel.ensureIndexes();
});

beforeEach(async () => {
  await DocumentModel.deleteMany({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(stopTestDb);

describe("normalizeContent", () => {
  it("normalizes CRLF and lone CR line endings", () => {
    expect(normalizeContent("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("strips trailing whitespace and collapses blank-line runs", () => {
    expect(normalizeContent("a  \n\n\n\n\nb\t")).toBe("a\n\nb");
  });

  it("converts non-breaking spaces to regular spaces", () => {
    expect(normalizeContent(`a${String.fromCharCode(160)}b`)).toBe("a b");
  });

  it("preserves code indentation and intra-line spacing", () => {
    const code = "def f():\n    return  x   +   y";
    expect(normalizeContent(code)).toBe(code);
  });

  it("is deterministic and idempotent", () => {
    const messy = "  a b \r\n\r\n\r\n c\t\t \r\n\r\n\r\n\r\nd  ";
    const once = normalizeContent(messy);
    expect(normalizeContent(once)).toBe(once);
    expect(normalizeContent(messy)).toBe(once);
  });

  it("reduces whitespace-only input to empty", () => {
    expect(normalizeContent(" \t\r\n\r\n   ")).toBe("");
  });
});

describe("hashContent", () => {
  it("returns the SHA-256 hex digest of the input", () => {
    expect(hashContent("hello")).toBe(sha256("hello"));
    expect(hashContent("hello")).toHaveLength(64);
  });
});

describe("ingestDocument", () => {
  it("creates a document on first ingest", async () => {
    const result = await ingestDocument(input());

    expect(result.outcome).toBe("created");
    expect(result.document.contentHash).toBe(
      sha256(normalizeContent("Stream API content"))
    );
    expect(await DocumentModel.countDocuments()).toBe(1);
  });

  it("returns 'unchanged' for identical re-ingestion without writing", async () => {
    const first = await ingestDocument(input());
    const second = await ingestDocument(input({ title: "Even a new title" }));

    expect(second.outcome).toBe("unchanged");
    expect(second.document._id.toString()).toBe(first.document._id.toString());
    // No write happened: metadata differences alone do not update the doc.
    const stored = await documentRepository.findById(
      first.document._id.toString()
    );
    expect(stored?.title).toBe("Streams");
    expect(await DocumentModel.countDocuments()).toBe(1);
  });

  it("updates the existing document when content changed", async () => {
    const first = await ingestDocument(input());
    const result = await ingestDocument(
      input({ title: "Retitled", content: "brand new body" })
    );

    expect(result.outcome).toBe("updated");
    expect(result.document._id.toString()).toBe(first.document._id.toString());
    expect(result.document.title).toBe("Retitled");
    expect(result.document.contentHash).toBe(sha256("brand new body"));

    const stored = await documentRepository.findById(
      first.document._id.toString()
    );
    expect(stored?.url).toBe(input().url);
    expect(await DocumentModel.countDocuments()).toBe(1);
  });

  it("keeps identical content at different URLs as separate documents", async () => {
    const a = await ingestDocument(input());
    const b = await ingestDocument(
      input({ url: "https://mirror.example.com/stream.html" })
    );

    expect(a.outcome).toBe("created");
    expect(b.outcome).toBe("created");
    expect(await DocumentModel.countDocuments()).toBe(2);
  });

  it("treats normalization-equivalent content as unchanged", async () => {
    await ingestDocument(input({ content: "line\r\n\r\n\r\nline  " }));
    const result = await ingestDocument(input({ content: "line\n\nline" }));

    expect(result.outcome).toBe("unchanged");
  });

  it("rejects content that is empty after normalization", async () => {
    await expect(ingestDocument(input({ content: "  \r\n\t  " }))).rejects.toMatchObject(
      { statusCode: 400, code: "VALIDATION_ERROR" }
    );
  });

  it("handles concurrent ingestion of the same identity", async () => {
    const [a, b] = await Promise.all([ingestDocument(input()), ingestDocument(input())]);

    // Exactly one insert wins; the loser hits the unique index, falls back to
    // the winner's document and reports 'unchanged'.
    expect([a.outcome, b.outcome].sort()).toEqual(["created", "unchanged"]);
    expect(a.document._id.toString()).toBe(b.document._id.toString());
    expect(await DocumentModel.countDocuments()).toBe(1);
  });

  it("lets repository failures propagate unmasked", async () => {
    const failure = new Error("connection lost");
    vi.spyOn(documentRepository, "findBySourceUrl").mockRejectedValue(failure);

    await expect(ingestDocument(input())).rejects.toBe(failure);
  });

  it("does not mask unexpected errors during create", async () => {
    const failure = new Error("disk full");
    // Force the repository's create path to throw a non-duplicate error while
    // findBySourceUrl legitimately reports no existing document.
    vi.spyOn(documentRepository, "create").mockRejectedValue(failure);

    await expect(ingestDocument(input())).rejects.toBe(failure);
  });

  it("does not convert non-duplicate AppErrors into an upsert", async () => {
    vi.spyOn(documentRepository, "create").mockRejectedValue(
      new AppError("other failure", 500, "OTHER")
    );

    await expect(ingestDocument(input())).rejects.toMatchObject({
      statusCode: 500,
      code: "OTHER",
    });
  });
});
