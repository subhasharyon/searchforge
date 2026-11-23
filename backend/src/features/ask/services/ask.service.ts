import { AppError } from "../../../shared/errors/app-error.js";
import { logger } from "../../../config/logger.js";
import { passageSearchDocuments } from "../../search/services/chunk-search.service.js";
import { getLlmProvider } from "./llm.service.js";
import { LlmError, type LlmProvider } from "./llm.provider.js";
import { buildContext } from "./context.service.js";
import type {
  AskCitation,
  AskQuery,
  AskResponse,
  AskSource,
} from "../types/ask.types.js";
import type { SearchDeps } from "../../search/types/search.types.js";

/* ------------------------------------------------------------------ */
/* RAG orchestration                                                    */
/*                                                                     */
/* question -> passage retrieval (existing hybrid-on-chunks) ->         */
/* numbered context -> LLM structured answer -> backend-validated      */
/* citations. Citations are NEVER trusted from the model: only refs    */
/* pointing into the actually-retrieved set survive.                   */
/* ------------------------------------------------------------------ */

/** Passages sent to the model per question. */
export const RAG_TOP_K = 8;

export interface AskDeps extends SearchDeps {
  /** LLM provider override; unset resolves from configuration. */
  llmProvider?: LlmProvider | null;
}

const INSUFFICIENT_ANSWER =
  "The indexed documentation does not contain enough evidence to answer this question.";

/**
 * Maps model citation refs (1-based [DOC n] indices) to verified
 * citations against the retrieved set. Unknown refs are dropped; one
 * citation per chunk is kept, deduped by chunkId.
 */
const validateCitations = (
  citationRefs: readonly number[],
  included: readonly { documentId: string; id: string; title: string; url: string; excerpt: string }[]
): AskCitation[] => {
  const seen = new Set<string>();
  const citations: AskCitation[] = [];
  for (const ref of citationRefs) {
    const passage = included[ref - 1];
    if (!passage || seen.has(passage.id)) {
      continue;
    }
    seen.add(passage.id);
    citations.push({
      documentId: passage.documentId,
      chunkId: passage.id,
      title: passage.title,
      url: passage.url,
      excerpt: passage.excerpt,
    });
  }
  return citations;
};

export const askQuestion = async (
  query: AskQuery,
  deps: AskDeps = {}
): Promise<AskResponse> => {
  const provider =
    deps.llmProvider !== undefined ? deps.llmProvider : getLlmProvider();
  if (!provider) {
    throw new AppError(
      "Answer generation is not configured on this deployment",
      503,
      "LLM_UNAVAILABLE"
    );
  }

  const retrievalStart = Date.now();
  const retrieval = await passageSearchDocuments(
    {
      q: query.question,
      page: 1,
      limit: RAG_TOP_K,
      mode: "passage",
      category: query.category,
      source: query.source,
      technology: query.technology,
      contentType: query.contentType,
    },
    deps
  );
  const retrievalMs = Date.now() - retrievalStart;

  const sources: AskSource[] = retrieval.results.map((p) => ({
    documentId: p.documentId,
    chunkId: p.id,
    title: p.title,
    url: p.url,
    heading: p.heading,
    excerpt: p.excerpt,
  }));

  /* Short-circuit: no evidence -> no paid LLM call, honest status. */
  if (retrieval.results.length === 0) {
    return {
      question: query.question,
      answer: INSUFFICIENT_ANSWER,
      status: "insufficient_evidence",
      citations: [],
      sources: [],
      meta: {
        model: provider.model,
        retrievalMode: "passage",
        retrievalMs,
        generationMs: 0,
        promptTokens: 0,
        outputTokens: 0,
      },
    };
  }

  const { context, included } = buildContext(retrieval.results);

  const generationStart = Date.now();
  let llmAnswer;
  try {
    llmAnswer = await provider.generateAnswer({
      question: query.question,
      context,
    });
  } catch (error) {
    if (error instanceof LlmError) {
      logger.warn(
        { err: error.message, code: error.code },
        "answer generation failed"
      );
      throw error;
    }
    logger.error(
      { err: error instanceof Error ? error.message : error },
      "unexpected answer-generation failure"
    );
    throw new AppError(
      "Answer generation failed",
      503,
      "LLM_UNAVAILABLE"
    );
  }
  const generationMs = Date.now() - generationStart;

  const citations = validateCitations(llmAnswer.citationRefs, included);

  return {
    question: query.question,
    answer: llmAnswer.answer,
    status:
      llmAnswer.status === "insufficient_evidence"
        ? "insufficient_evidence"
        : "answered",
    citations,
    sources,
    meta: {
      model: provider.model,
      retrievalMode: "passage",
      retrievalMs,
      generationMs,
      promptTokens: llmAnswer.promptTokens,
      outputTokens: llmAnswer.outputTokens,
    },
  };
};
