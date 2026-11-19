import { AppError } from "../../../shared/errors/app-error.js";
import {
  RELEVANT_THRESHOLD,
  type KMetrics,
  type ResolvedJudgment,
} from "../types/evaluation.types.js";

/**
 * Information-retrieval metrics over a ranked result list.
 *
 * Conventions:
 *  - ranked ids are deduplicated first (a duplicate hit never counts twice)
 *  - binary metrics treat grade >= RELEVANT_THRESHOLD as relevant
 *  - recall/f1/ndcg are null (not zero) when the query has no positively
 *    judged documents - a mean over "undefined" queries would be silent
 *    and misleading, so aggregates report the count they averaged over.
 */

export const assertValidK = (k: number): void => {
  if (!Number.isInteger(k) || k < 1) {
    throw new AppError(
      "K must be a positive integer",
      400,
      "VALIDATION_ERROR"
    );
  }
};

const dedupeRanked = (ranked: string[]): string[] => [...new Set(ranked)];

export const precisionAtK = (
  ranked: string[],
  relevantIds: ReadonlySet<string>,
  k: number
): number => {
  assertValidK(k);
  const hits = dedupeRanked(ranked)
    .slice(0, k)
    .filter((id) => relevantIds.has(id)).length;
  return hits / k;
};

/** null when there are no relevant documents to recall. */
export const recallAtK = (
  ranked: string[],
  relevantIds: ReadonlySet<string>,
  k: number
): number | null => {
  assertValidK(k);
  if (relevantIds.size === 0) {
    return null;
  }
  const hits = dedupeRanked(ranked)
    .slice(0, k)
    .filter((id) => relevantIds.has(id)).length;
  return hits / relevantIds.size;
};

export const f1AtK = (
  ranked: string[],
  relevantIds: ReadonlySet<string>,
  k: number
): number | null => {
  const recall = recallAtK(ranked, relevantIds, k);
  if (recall === null) {
    return null;
  }
  const precision = precisionAtK(ranked, relevantIds, k);
  if (precision === 0 && recall === 0) {
    return 0;
  }
  return (2 * precision * recall) / (precision + recall);
};

/**
 * Reciprocal rank of the first relevant hit; 0 when none is retrieved,
 * null when the query has no relevant documents at all.
 */
export const reciprocalRank = (
  ranked: string[],
  relevantIds: ReadonlySet<string>
): number | null => {
  if (relevantIds.size === 0) {
    return null;
  }
  const index = dedupeRanked(ranked).findIndex((id) => relevantIds.has(id));
  return index === -1 ? 0 : 1 / (index + 1);
};

const dcgGain = (grade: number): number => Math.pow(2, grade) - 1;

/** DCG@K over graded judgments; unjudged hits contribute gain 0. */
export const dcgAtK = (
  ranked: string[],
  grades: ReadonlyMap<string, number>,
  k: number
): number => {
  assertValidK(k);
  return dedupeRanked(ranked)
    .slice(0, k)
    .reduce((sum, id, position) => {
      const grade = grades.get(id) ?? 0;
      return sum + dcgGain(grade) / Math.log2(position + 2);
    }, 0);
};

/** Ideal DCG@K: the judged grades sorted best-first. */
export const idealDcgAtK = (judgments: readonly ResolvedJudgment[], k: number): number => {
  assertValidK(k);
  const ideal = judgments
    .map((j) => j.grade)
    .sort((a, b) => b - a)
    .slice(0, k);
  return ideal.reduce<number>(
    (sum, grade, position) => sum + dcgGain(grade) / Math.log2(position + 2),
    0
  );
};

/** null when IDCG = 0 (no positively-judged documents exist). */
export const ndcgAtK = (
  ranked: string[],
  judgments: readonly ResolvedJudgment[],
  k: number
): number | null => {
  assertValidK(k);
  const ideal = idealDcgAtK(judgments, k);
  if (ideal === 0) {
    return null;
  }
  const grades = new Map(judgments.map((j) => [j.documentId, j.grade]));
  return dcgAtK(ranked, grades, k) / ideal;
};

/** All metrics for one query at one K. */
export const computeKMetrics = (
  ranked: string[],
  judgments: readonly ResolvedJudgment[],
  k: number
): KMetrics => {
  const relevantIds = new Set(
    judgments
      .filter((j) => j.grade >= RELEVANT_THRESHOLD)
      .map((j) => j.documentId)
  );
  const precision = precisionAtK(ranked, relevantIds, k);
  const recall = recallAtK(ranked, relevantIds, k);
  const f1 = f1AtK(ranked, relevantIds, k);
  const grades = new Map(judgments.map((j) => [j.documentId, j.grade]));
  const dcg = dcgAtK(ranked, grades, k);
  const ndcg = ndcgAtK(ranked, judgments, k);
  return { precision, recall, f1, dcg, ndcg };
};

/** Mean over queries where the metric is defined; null if none are. */
export const meanNullable = (values: readonly (number | null)[]): number | null => {
  const defined = values.filter((v): v is number => v !== null);
  if (defined.length === 0) {
    return null;
  }
  return defined.reduce((a, b) => a + b, 0) / defined.length;
};
