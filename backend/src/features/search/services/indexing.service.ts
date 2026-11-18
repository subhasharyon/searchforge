import { logger } from "../../../config/logger.js";
import type { DocumentDocument } from "../../documents/repositories/document.repository.js";
import { SEARCH_INDEX_ALIAS } from "./index-manager.service.js";
import { getSearchClient } from "./es-client.provider.js";
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
});

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

export const syncDocumentToIndex = async (
  doc: DocumentDocument
): Promise<void> => {
  try {
    await indexDocument(doc);
  } catch (error) {
    logger.error(
      {
        err: error instanceof Error ? error.message : error,
        documentId: doc._id.toString(),
      },
      "Elasticsearch indexing failed; MongoDB document remains canonical"
    );
  }
};

export const removeDocumentFromIndex = async (
  documentId: string
): Promise<void> => {
  try {
    await removeDocument(documentId);
  } catch (error) {
    logger.error(
      {
        err: error instanceof Error ? error.message : error,
        documentId,
      },
      "Elasticsearch delete failed; run a reindex to reconcile"
    );
  }
};
