import { env } from "../../../config/env.js";
import {
  EmbeddingError,
  embeddingDeps,
  type EmbeddingProvider,
} from "./embedding.provider.js";
import { LocalHashEmbeddingProvider } from "./local-embedding.provider.js";
import { createOpenAiCompatProvider } from "./openai-compat.provider.js";

let defaultProvider: EmbeddingProvider | null | undefined;

const buildProvider = (): EmbeddingProvider | null => {
  switch (env.EMBEDDING_PROVIDER) {
    case "disabled":
      return null;
    case "local":
      if (!env.EMBEDDING_DIMS) {
        throw new EmbeddingError(
          "EMBEDDING_PROVIDER=local requires EMBEDDING_DIMS",
          "EMBEDDING_UNCONFIGURED"
        );
      }
      return new LocalHashEmbeddingProvider(env.EMBEDDING_DIMS);
    case "openai-compat":
      return createOpenAiCompatProvider();
  }
};

/**
 * The configured provider, or null when EMBEDDING_PROVIDER=disabled.
 * Misconfiguration fails loudly on first resolution - an explicit error is
 * far better than indexing an incompatible vector field silently.
 */
export const getEmbeddingProvider = (): EmbeddingProvider | null => {
  if (embeddingDeps.provider !== undefined) {
    return embeddingDeps.provider;
  }
  if (defaultProvider === undefined) {
    defaultProvider = buildProvider();
  }
  return defaultProvider;
};

/**
 * Dims for index mapping creation: the provider's contract, not a guess.
 * Returns undefined when semantic search is disabled - the index is then
 * created without a vector field at all.
 */
export const resolveVectorDims = (): number | undefined =>
  getEmbeddingProvider()?.dims;
