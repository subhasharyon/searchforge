/**
 * Embedding provider abstraction.
 *
 * One embedding per document, built from `buildEmbeddingInput` below.
 * Providers are created via the `embeddingDeps` seam (tests) or lazily
 * from EMBEDDING_* env vars - search/ingestion code never constructs a
 * concrete provider itself.
 */
export class EmbeddingError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable = false
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}

export interface EmbeddingProvider {
  /**
   * Stable identifier of the model that produced a vector. Persisted on
   * each document; a change makes every stored vector stale.
   */
  readonly model: string;
  readonly dims: number;
  /** Batch embeddings; order of outputs matches order of inputs. */
  embedDocuments(texts: readonly string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

/**
 * Injection seam, mirroring `searchIndexDeps` in es-client.provider.ts.
 * Tests assign `embeddingDeps.provider`; production code resolves lazily
 * through `getEmbeddingProvider`.
 */
export const embeddingDeps: {
  provider?: EmbeddingProvider | null;
} = {};

/**
 * Guards the trust boundary: providers may return the wrong shape, wrong
 * dimensionality, or NaN/Infinity. A bad vector must never reach ES -
 * dense_vector rejects it at index time anyway, so fail earlier and clear.
 */
export const assertEmbedding = (
  vector: unknown,
  dims: number
): number[] => {
  if (
    !Array.isArray(vector) ||
    vector.length !== dims ||
    !vector.every((v) => typeof v === "number" && Number.isFinite(v))
  ) {
    throw new EmbeddingError(
      `Provider returned a malformed embedding (expected ${dims} finite numbers)`,
      "EMBEDDING_BAD_RESPONSE"
    );
  }
  return vector;
};

/** ~4k-token headroom; providers truncate beyond their own context anyway. */
export const MAX_EMBEDDING_INPUT_CHARS = 16_000;

/**
 * The text actually embedded for a document. Title is repeated because
 * it carries the strongest topical signal for short technical docs.
 */
export const buildEmbeddingInput = (
  title: string,
  content: string
): string => `${title}\n\n${title}\n\n${content}`.slice(0, MAX_EMBEDDING_INPUT_CHARS);

/**
 * True when the document's stored vector is missing, built from stale
 * content, or produced by a different model.
 */
export const embeddingIsStale = (
  doc: {
    contentHash: string;
    contentVector?: number[];
    embeddingModel?: string;
    embeddedContentHash?: string;
  },
  provider: EmbeddingProvider
): boolean =>
  !doc.contentVector?.length ||
  doc.embeddingModel !== provider.model ||
  doc.embeddedContentHash !== doc.contentHash;
