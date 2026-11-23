import type {
  DocumentCategory,
  DocumentContentType,
} from "../../documents/types/document.types.js";

/** Validated /api/v1/ask payload (ask.validators.ts z.infer shape). */
export interface AskQuery {
  question: string;
  category?: DocumentCategory;
  source?: string;
  technology?: string;
  contentType?: DocumentContentType;
}

/** A citation the backend verified points at an actually-retrieved
    passage - never raw LLM text. */
export interface AskCitation {
  documentId: string;
  /** Chunk ES _id (`{docId}:{index}`); null slot reserved for compat. */
  chunkId: string | null;
  title: string;
  url: string;
  excerpt: string;
}

/** Full metadata for every retrieved passage - the frontend renders
    source chips from this without trusting LLM text. */
export interface AskSource {
  documentId: string;
  chunkId: string;
  title: string;
  url: string;
  heading: string;
  excerpt: string;
}

export interface AskResponse {
  question: string;
  answer: string;
  status: "answered" | "insufficient_evidence";
  citations: AskCitation[];
  sources: AskSource[];
  meta: {
    model: string;
    retrievalMode: "passage";
    retrievalMs: number;
    generationMs: number;
    promptTokens: number;
    outputTokens: number;
  };
}
