import { cache } from "react"

import { authorizedJson } from "@/lib/api/client"
import type { DocumentDetail } from "@/types/document"

async function fetchDocumentById(id: string): Promise<DocumentDetail> {
  const data = await authorizedJson<{ document: DocumentDetail }>(
    `/api/v1/documents/${encodeURIComponent(id)}`
  )
  return data.document
}

/**
 * Fetches a document by its MongoDB _id (which is also the ES hit id used
 * by search results). React `cache` dedupes within a single render so the
 * page and generateMetadata share one backend request.
 */
export const getDocumentById = cache(fetchDocumentById)
