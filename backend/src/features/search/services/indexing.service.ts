import { logger } from "../../../config/logger.js";
import type { DocumentDocument } from "../../documents/repositories/document.repository.js";
import {
  CHUNK_INDEX_ALIAS,
  SEARCH_INDEX_ALIAS,
} from "./index-manager.service.js";
import { getSearchClient } from "./es-client.provider.js";
import { getEmbeddingProvider } from "./embedding.service.js";
import {
  buildEmbeddingInput,
  embeddingIsStale,
} from "./embedding.provider.js";
import {
  chunkDocument,
  chunkInputHash,
  type DocumentChunk,
} from "./chunking.service.js";
import type {
  SearchDeps,
  SearchDocument,
} from "../types/search.types.js";

/**
 * Index document ID strategy: the canonical MongoDB _id hex string.
 * Stable across rebuilds, unique per document, and makes rebuilds and
 * repeated syncs naturally idempotent (ES index is an upsert by _id).
 */
export const toSearchDocument = (
  doc: DocumentDocument
): SearchDocument => ({
  title: doc.title,
  url: doc.url,
  source: doc.source,
  category: doc.category,
  contentType: doc.contentType,
  technologies: doc.technologies,
  content: doc.content,
  contentHash: doc.contentHash,
  ...(doc.sourceId !== undefined ? { sourceId: doc.sourceId } : {}),
  ...(doc.author !== undefined ? { author: doc.author } : {}),
  ...(doc.publishedAt !== undefined
    ? { publishedAt: doc.publishedAt.toISOString() }
    : {}),
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
  // Vector fields only travel when the Mongo copy is valid; a failed or
  // stale embedding leaves them absent so the doc can never match kNN.
  ...(doc.contentVector?.length
    ? {
        content_vector: doc.contentVector,
        embeddingModel: doc.embeddingModel,
        embeddedContentHash: doc.embeddedContentHash,
      }
    : {}),
});

/**
 * Generates and persists a document embedding when the provider considers
 * it stale. Returns true when a vector is present afterwards (fresh or
 * reused). A provider failure NEVER throws here - the caller still indexes
 * the plain document fields, and the stale hash in Mongo guarantees the
 * next sync or reindex retries the embedding.
 */
export const ensureDocumentEmbedding = async (
  doc: DocumentDocument,
  deps: SearchDeps = {}
): Promise<boolean> => {
  const provider = deps.embeddingProvider !== undefined
    ? deps.embeddingProvider
    : getEmbeddingProvider();
  if (!provider) {
    return Boolean(doc.contentVector?.length);
  }
  if (!embeddingIsStale(doc, provider)) {
    return true;
  }
  try {
    const [vector] = await provider.embedDocuments([
      buildEmbeddingInput(doc.title, doc.content),
    ]);
    doc.contentVector = vector;
    doc.embeddingModel = provider.model;
    doc.embeddedContentHash = doc.contentHash;
    await doc.save();
    return true;
  } catch (error) {
    logger.warn(
      {
        err: error instanceof Error ? error.message : error,
        documentId: doc._id.toString(),
      },
      "embedding generation failed; indexing document without a vector"
    );
    // The stored vector was stale (that's why we tried to embed): drop it
    // from Mongo so it can never reach the index as a false positive.
    doc.contentVector = undefined;
    doc.embeddingModel = undefined;
    doc.embeddedContentHash = undefined;
    await doc.save();
    return false;
  }
};

/** Upserts the document into the search index (index = create-or-replace). */
export const indexDocument = async (
  doc: DocumentDocument,
  deps: SearchDeps = {}
): Promise<void> => {
  const client = deps.client ?? (await getSearchClient());
  await client.index({
    index: SEARCH_INDEX_ALIAS,
    id: doc._id.toString(),
    document: toSearchDocument(doc),
  });
};

const isEsNotFound = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  ("statusCode" in error
    ? error.statusCode === 404
    : "meta" in error &&
      typeof error.meta === "object" &&
      error.meta !== null &&
      "statusCode" in error.meta &&
      error.meta.statusCode === 404);

/**
 * Removes the document from the search index. Deleting is idempotent: a
 * 404 (never indexed, or already removed) is not an error.
 */
export const removeDocument = async (
  documentId: string,
  deps: SearchDeps = {}
): Promise<void> => {
  const client = deps.client ?? (await getSearchClient());
  try {
    await client.delete({ index: SEARCH_INDEX_ALIAS, id: documentId });
  } catch (error) {
    if (!isEsNotFound(error)) {
      throw error;
    }
  }
};

/* ------------------------------------------------------------------ */
/* Write-path synchronization                                          */
/*                                                                     */
/* Consistency model: MongoDB is canonical; Elasticsearch is a         */
/* disposable projection. A failed sync NEVER fails the Mongo write -  */
/* the document stays safely stored and a later admin reindex closes   */
/* the gap. Failures are logged loudly (never swallowed silently) with */
/* the document id so they can be traced and repaired.                 */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Chunk projection (M7.3)                                             */
/*                                                                     */
/* Chunks are derived data in a separate index family. On every doc   */
/* sync the chunk set is replaced wholesale (delete-by-query then      */
/* bulk) - chunk _ids are deterministic (`{docId}:{index}`), so the    */
/* replacement is idempotent and drift-free. A chunk-sync failure is   */
/* isolated from the document sync: the document stays searchable,    */
/* and the next sync or reindex rebuilds the chunks.                  */
/* ------------------------------------------------------------------ */

/** Embedding input for a chunk: document title (repeated, matching the
    document-level convention) plus the section heading as context. */
const chunkEmbeddingInput = (
  title: string,
  chunk: DocumentChunk
): string =>
  buildEmbeddingInput(
    title,
    chunk.heading ? `${chunk.heading}\n\n${chunk.content}` : chunk.content
  );

const toChunkDocument = (
  doc: DocumentDocument,
  chunk: DocumentChunk,
  vector?: number[],
  model?: string,
  inputHash?: string
): Record<string, unknown> => ({
  parent_document_id: doc._id.toString(),
  chunk_index: chunk.index,
  title: doc.title,
  heading: chunk.heading,
  content: chunk.content,
  url: doc.url,
  source: doc.source,
  category: doc.category,
  contentType: doc.contentType,
  technologies: doc.technologies,
  updatedAt: doc.updatedAt.toISOString(),
  ...(vector?.length
    ? {
        content_vector: vector,
        embeddingModel: model,
        embeddedContentHash: inputHash,
      }
    : {}),
});

const isIndexMissing = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  JSON.stringify(error).includes("index_not_found_exception");

/** Chunks per embedding call: keeps token volume under provider
    token-per-minute limits and bounds partial-failure blast radius. */
export const CHUNK_EMBED_BATCH_SIZE = 16;

/**
 * Rebuilds the chunk projection for one document. Chunks embed in
 * bounded batches; a failed batch indexes those chunks WITHOUT vectors
 * (BM25 passage retrieval still works) and never throws.
 * `deps.embedBatchDelayMs` paces batches for free-tier bulk scripts.
 */
export const syncChunksToIndex = async (
  doc: DocumentDocument,
  deps: SearchDeps = {}
): Promise<void> => {
  const client = deps.client ?? (await getSearchClient());
  const parentId = doc._id.toString();

  const chunks = chunkDocument(doc.content);
  if (chunks.length === 0) {
    return;
  }

  const provider =
    deps.embeddingProvider !== undefined
      ? deps.embeddingProvider
      : getEmbeddingProvider();
  const inputs = chunks.map((chunk) =>
    chunkEmbeddingInput(doc.title, chunk)
  );
  /* Embed in bounded batches: a single call carrying a large document's
     whole chunk set trips provider token-per-minute limits, and batching
     also makes failures partial - good batches keep their vectors. */
  const vectors: (number[] | undefined)[] = Array.from({
    length: chunks.length,
  });
  if (provider) {
    const delay = deps.embedBatchDelayMs ?? 0;
    for (let i = 0; i < chunks.length; i += CHUNK_EMBED_BATCH_SIZE) {
      if (i > 0 && delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      const sliceInputs = inputs.slice(i, i + CHUNK_EMBED_BATCH_SIZE);
      try {
        const slice = await provider.embedDocuments(sliceInputs);
        for (const [j, v] of slice.entries()) {
          vectors[i + j] = v;
        }
      } catch (error) {
        logger.warn(
          {
            err: error instanceof Error ? error.message : error,
            documentId: parentId,
            batch: Math.floor(i / CHUNK_EMBED_BATCH_SIZE),
          },
          "chunk embed batch failed; those chunks index without vectors"
        );
      }
    }
  }

  try {
    await client.deleteByQuery({
      index: CHUNK_INDEX_ALIAS,
      query: { term: { parent_document_id: parentId } },
    });
    const operations: Record<string, unknown>[] = chunks.flatMap(
      (chunk, i) => [
        { index: { _id: `${parentId}:${chunk.index}` } },
        toChunkDocument(
          doc,
          chunk,
          vectors[i],
          provider?.model,
          vectors[i] ? chunkInputHash(inputs[i] ?? "") : undefined
        ),
      ]
    );
    const result = await client.bulk({
      index: CHUNK_INDEX_ALIAS,
      operations,
    });
    if (result.errors) {
      logger.warn(
        { documentId: parentId },
        "chunk bulk index reported item failures"
      );
    }
  } catch (error) {
    if (isIndexMissing(error)) {
      logger.warn(
        { documentId: parentId },
        "chunk index missing; run ensureChunkIndex"
      );
      return;
    }
    throw error;
  }
};

/** Removes all chunks of a document. Idempotent: an empty match set or a
    missing chunk index is not an error. */
export const removeChunksFromIndex = async (
  documentId: string,
  deps: SearchDeps = {}
): Promise<void> => {
  const client = deps.client ?? (await getSearchClient());
  try {
    await client.deleteByQuery({
      index: CHUNK_INDEX_ALIAS,
      query: { term: { parent_document_id: documentId } },
    });
  } catch (error) {
    if (!isIndexMissing(error)) {
      throw error;
    }
  }
};

export const syncDocumentToIndex = async (
  doc: DocumentDocument,
  deps: SearchDeps = {}
): Promise<void> => {
  try {
    await ensureDocumentEmbedding(doc, deps);
    await indexDocument(doc, deps);
  } catch (error) {
    logger.error(
      {
        err: error instanceof Error ? error.message : error,
        documentId: doc._id.toString(),
      },
      "Elasticsearch indexing failed; MongoDB document remains canonical"
    );
    return;
  }
  // Chunk projection is isolated: a chunk-sync failure never fails the
  // document write and is repairable by the next sync or a reindex.
  try {
    await syncChunksToIndex(doc, deps);
  } catch (error) {
    logger.error(
      {
        err: error instanceof Error ? error.message : error,
        documentId: doc._id.toString(),
      },
      "Elasticsearch chunk indexing failed; chunks are rebuildable"
    );
  }
};

export const removeDocumentFromIndex = async (
  documentId: string,
  deps: SearchDeps = {}
): Promise<void> => {
  try {
    await removeDocument(documentId, deps);
  } catch (error) {
    logger.error(
      {
        err: error instanceof Error ? error.message : error,
        documentId,
      },
      "Elasticsearch delete failed; run a reindex to reconcile"
    );
  }
  try {
    await removeChunksFromIndex(documentId, deps);
  } catch (error) {
    logger.error(
      {
        err: error instanceof Error ? error.message : error,
        documentId,
      },
      "Elasticsearch chunk delete failed; run a reindex to reconcile"
    );
  }
};
