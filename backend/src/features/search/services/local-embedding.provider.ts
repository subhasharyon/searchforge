import { createHash } from "node:crypto";
import {
  assertEmbedding,
  type EmbeddingProvider,
} from "./embedding.provider.js";

/**
 * Deterministic feature-hashing provider for DEVELOPMENT AND TESTS ONLY.
 *
 * Each lowercase word token is hashed to a (bucket, sign) pair and summed;
 * the result is L2-normalized. Similar texts share tokens and therefore
 * end up closer in cosine space - enough to exercise the full kNN path
 * end-to-end without credentials or paid calls - but these vectors carry
 * NO real semantic meaning. Never enable this provider in production.
 */
export class LocalHashEmbeddingProvider implements EmbeddingProvider {
  readonly model = `local-hash-v1`;
  constructor(readonly dims: number) {
    if (!Number.isInteger(dims) || dims < 16) {
      throw new Error("EMBEDDING_DIMS must be an integer >= 16");
    }
  }

  private bucketize(token: string): { index: number; sign: number } {
    const digest = createHash("sha256").update(token).digest();
    const n = digest.readUInt32BE(0);
    return { index: n % this.dims, sign: (digest[4] ?? 0) % 2 === 0 ? 1 : -1 };
  }

  private embed(text: string): number[] {
    const vector = Array.from({ length: this.dims }, () => 0);
    for (const token of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      const { index, sign } = this.bucketize(token);
      vector[index] = (vector[index] ?? 0) + sign;
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vector.map((v) => v / norm);
  }

  async embedDocuments(texts: readonly string[]): Promise<number[][]> {
    return texts.map((t) => assertEmbedding(this.embed(t), this.dims));
  }

  async embedQuery(text: string): Promise<number[]> {
    return assertEmbedding(this.embed(text), this.dims);
  }
}
