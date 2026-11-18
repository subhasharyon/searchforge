import { createHash } from "node:crypto";
import { AppError } from "../../../shared/errors/app-error.js";
import { documentRepository } from "../repositories/document.repository.js";
import type { DocumentDocument } from "../repositories/document.repository.js";
import {
  createDocument,
  updateDocument,
} from "./document.service.js";
import type {
  CreateDocumentInput,
  IngestDocumentInput,
  UpdateDocumentInput,
} from "../types/document.types.js";

export type IngestOutcome = "created" | "unchanged" | "updated";

export interface IngestResult {
  outcome: IngestOutcome;
  document: DocumentDocument;
}

/**
 * Canonical content normalization applied on EVERY write path so that
 * contentHash always reflects sha256(normalized content). Deterministic and
 * idempotent: normalize(normalize(x)) === normalize(x).
 *
 *   - CRLF/CR -> LF
 *   - non-breaking spaces -> regular spaces
 *   - trailing whitespace stripped per line
 *   - runs of 3+ newlines collapse to one blank line
 *
 * Intra-line spacing and indentation are never touched, so code snippets
 * and meaningful formatting survive intact.
 */
export const normalizeContent = (raw: string): string =>
  raw
    .replace(/\u00A0/g, " ")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/u, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export const hashContent = (normalizedContent: string): string =>
  createHash("sha256").update(normalizedContent, "utf8").digest("hex");

const emptyContentError = (): AppError =>
  new AppError(
    "content must not be empty after normalization",
    400,
    "VALIDATION_ERROR"
  );

/**
 * Normalizes content and derives contentHash for a create/ingest payload.
 * Throws VALIDATION_ERROR when the payload carries no usable content.
 */
export const prepareDocumentInput = (
  input: IngestDocumentInput
): CreateDocumentInput => {
  const content = normalizeContent(input.content);
  if (content.length === 0) {
    throw emptyContentError();
  }
  return { ...input, content, contentHash: hashContent(content) };
};

/**
 * Same normalization for partial updates: content (and its hash) is only
 * recomputed when the update actually carries new content.
 */
export const prepareDocumentUpdate = (
  update: UpdateDocumentInput
): UpdateDocumentInput => {
  if (update.content === undefined) {
    return update;
  }
  const content = normalizeContent(update.content);
  if (content.length === 0) {
    throw emptyContentError();
  }
  return { ...update, content, contentHash: hashContent(content) };
};

/**
 * Upsert policy for an existing document identity:
 *   - identical normalized content  -> no write, outcome "unchanged".
 *     Metadata differences alone do not trigger a write; corrections go
 *     through the PATCH endpoint (documented, deterministic policy).
 *   - changed normalized content    -> update all non-identity fields,
 *     outcome "updated". source/url are immutable identity and never change.
 */
const upsertExisting = async (
  existing: DocumentDocument,
  prepared: CreateDocumentInput
): Promise<IngestResult> => {
  if (existing.contentHash === prepared.contentHash) {
    return { outcome: "unchanged", document: existing };
  }

  // Identity fields (source, url) are immutable - update the explicit
  // whitelist of mutable fields only.
  const document = await updateDocument(existing._id.toString(), {
    title: prepared.title,
    category: prepared.category,
    contentType: prepared.contentType,
    technologies: prepared.technologies,
    content: prepared.content,
    contentHash: prepared.contentHash,
    sourceId: prepared.sourceId,
    author: prepared.author,
    publishedAt: prepared.publishedAt,
  });
  return { outcome: "updated", document };
};

/**
 * Content ingestion workflow:
 *   1. Normalize the incoming content and hash it.
 *   2. Resolve canonical identity by (source, url).
 *   3. Create when absent; apply the upsert policy when present.
 *   4. If a concurrent ingest won the (source, url) unique-index race between
 *      the lookup and the insert, fetch the winner and apply the same policy
 *      instead of surfacing the duplicate-key conflict.
 * Only the expected duplicate-identity error is handled - every other
 * database failure propagates to the caller unmasked.
 */
export const ingestDocument = async (
  input: IngestDocumentInput
): Promise<IngestResult> => {
  const prepared = prepareDocumentInput(input);

  const existing = await documentRepository.findBySourceUrl(
    prepared.source,
    prepared.url
  );
  if (existing) {
    return upsertExisting(existing, prepared);
  }

  try {
    const document = await createDocument(prepared);
    return { outcome: "created", document };
  } catch (error) {
    if (
      !(error instanceof AppError) ||
      error.code !== "DOCUMENT_ALREADY_EXISTS"
    ) {
      throw error;
    }

    const raced = await documentRepository.findBySourceUrl(
      prepared.source,
      prepared.url
    );
    if (!raced) {
      throw error;
    }
    return upsertExisting(raced, prepared);
  }
};
