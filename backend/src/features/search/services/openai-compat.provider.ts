import { env } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";
import {
  EmbeddingError,
  assertEmbedding,
  type EmbeddingProvider,
} from "./embedding.provider.js";

const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = [250, 1000];

interface OpenAiEmbeddingsResponse {
  data?: { embedding?: unknown; index?: number }[];
}

/**
 * OpenAI-compatible embeddings API adapter (`POST {apiUrl}/embeddings`
 * with `{model, input}` -> `{data:[{embedding,index}]}`). Covers OpenAI,
 * Voyage (their OpenAI-compatible endpoint), and self-hosted servers that
 * implement the same contract. The concrete provider/model is chosen via
 * EMBEDDING_* env vars - nothing is hard-coded here.
 */
export class OpenAiCompatEmbeddingProvider implements EmbeddingProvider {
  constructor(
    readonly model: string,
    readonly dims: number,
    private readonly apiUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number
  ) {}

  private async request(texts: readonly string[]): Promise<number[][]> {
    const url = `${this.apiUrl.replace(/\/$/, "")}/embeddings`;
    let lastError: EmbeddingError | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt - 1]));
      }
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({ model: this.model, input: [...texts] }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        lastError = new EmbeddingError(
          `Embedding request failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          "EMBEDDING_TRANSPORT",
          true
        );
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        throw new EmbeddingError(
          "Embedding provider rejected credentials",
          "EMBEDDING_AUTH_FAILED"
        );
      }
      if (response.status === 429 || response.status >= 500) {
        lastError = new EmbeddingError(
          `Embedding provider error (HTTP ${response.status})`,
          response.status === 429
            ? "EMBEDDING_RATE_LIMITED"
            : "EMBEDDING_PROVIDER_ERROR",
          true
        );
        continue;
      }
      if (!response.ok) {
        throw new EmbeddingError(
          `Embedding provider error (HTTP ${response.status})`,
          "EMBEDDING_PROVIDER_ERROR"
        );
      }

      const body = (await response.json()) as OpenAiEmbeddingsResponse;
      if (!Array.isArray(body?.data) || body.data.length !== texts.length) {
        throw new EmbeddingError(
          "Embedding provider returned an unexpected response shape",
          "EMBEDDING_BAD_RESPONSE"
        );
      }
      const sorted = [...body.data].sort(
        (a, b) => (a.index ?? 0) - (b.index ?? 0)
      );
      return sorted.map((item) => assertEmbedding(item.embedding, this.dims));
    }

    throw lastError ?? new EmbeddingError("Embedding request failed", "EMBEDDING_TRANSPORT", true);
  }

  async embedDocuments(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    return this.request(texts);
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.request([text]);
    if (!vector) {
      throw new EmbeddingError(
        "Embedding provider returned no vector",
        "EMBEDDING_BAD_RESPONSE"
      );
    }
    return vector;
  }
}

/** Validates env for openai-compat; a clear failure beats a silent misconfig. */
export const createOpenAiCompatProvider = (): EmbeddingProvider => {
  const missing = [
    ["EMBEDDING_API_URL", env.EMBEDDING_API_URL],
    ["EMBEDDING_API_KEY", env.EMBEDDING_API_KEY],
    ["EMBEDDING_MODEL", env.EMBEDDING_MODEL],
    ["EMBEDDING_DIMS", env.EMBEDDING_DIMS],
  ]
    .filter(([, v]) => v === undefined || v === "")
    .map(([k]) => k);
  if (missing.length > 0) {
    logger.error(
      { missing },
      "EMBEDDING_PROVIDER=openai-compat is missing required configuration"
    );
    throw new EmbeddingError(
      `Embedding provider misconfigured: missing ${missing.join(", ")}`,
      "EMBEDDING_UNCONFIGURED"
    );
  }
  return new OpenAiCompatEmbeddingProvider(
    env.EMBEDDING_MODEL!,
    env.EMBEDDING_DIMS!,
    env.EMBEDDING_API_URL!,
    env.EMBEDDING_API_KEY!,
    env.EMBEDDING_TIMEOUT_MS
  );
};
