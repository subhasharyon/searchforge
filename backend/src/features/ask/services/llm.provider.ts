import { AppError } from "../../../shared/errors/app-error.js";

/**
 * LLM provider seam - the same pattern as EmbeddingProvider:
 * business logic depends on this interface only; the concrete adapter
 * (Anthropic today) is resolved from environment configuration and
 * injected in tests through `llmDeps`.
 */

export interface LlmRequest {
  question: string;
  /** Pre-rendered numbered context block (context.service.ts). */
  context: string;
}

/**
 * The model's structured answer. `citationRefs` are 1-based indices into
 * the context list - the backend validates them against the actually
 * retrieved passages before anything reaches the client.
 */
export interface LlmAnswer {
  status: "answered" | "insufficient_evidence";
  answer: string;
  citationRefs: number[];
  promptTokens: number;
  outputTokens: number;
}

export interface LlmProvider {
  readonly model: string;
  generateAnswer(request: LlmRequest): Promise<LlmAnswer>;
}

/**
 * Test seam: inject `llmDeps.provider` to stub the configured provider
 * (including `null` to simulate "no provider configured").
 */
export const llmDeps: { provider?: LlmProvider | null } = {};

export type LlmErrorCode =
  | "LLM_UNAVAILABLE"
  | "LLM_RATE_LIMITED"
  | "LLM_TIMEOUT"
  | "LLM_INVALID_RESPONSE"
  | "LLM_UNCONFIGURED";

export class LlmError extends AppError {
  readonly retryable: boolean;

  constructor(
    message: string,
    code: LlmErrorCode,
    retryable = false,
    statusCode = 503
  ) {
    super(message, statusCode, code);
    this.retryable = retryable;
  }
}
