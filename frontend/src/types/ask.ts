/**
 * /api/v1/ask response contract (M7.4 backend).
 */

export interface AskCitation {
  documentId: string;
  chunkId: string | null;
  title: string;
  url: string;
  excerpt: string;
}

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
