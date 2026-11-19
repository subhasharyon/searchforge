import { AppError } from "../../../shared/errors/app-error.js";
import { searchDocuments } from "../../search/services/search.service.js";
import type { SearchDeps } from "../../search/types/search.types.js";
import { EVALUATION_DATASET } from "../dataset/evaluation.dataset.js";
import {
  computeKMetrics,
  meanNullable,
  reciprocalRank,
  assertValidK,
} from "./metrics.service.js";
import {
  assertValidDataset,
  resolveDatasetJudgments,
} from "./dataset.service.js";
import {
  RELEVANT_THRESHOLD,
  type CoverageReport,
  type EvaluatedQueryResult,
  type EvaluationDataset,
  type EvaluationReport,
  type KMetrics,
  type QueryFailure,
  type ResolvedJudgment,
} from "../types/evaluation.types.js";

export const DEFAULT_K_VALUES = [1, 3, 5, 10] as const;

export interface EvaluateOptions {
  kValues?: number[];
  deps?: SearchDeps;
  /** Experiment label/config recorded in the report. */
  experiment?: { name: string; config: Record<string, number> };
}

/**
 * Evaluation runner: executes every dataset query through the REAL
 * searchDocuments service (the same code path the API uses), scores the
 * ranked ids against resolved judgments and aggregates per-K metrics.
 *
 * Queries whose search call throws are recorded as failures and excluded
 * from aggregates - they never produce fake zero scores.
 */
export const evaluateDataset = async (
  dataset: EvaluationDataset = EVALUATION_DATASET,
  options: EvaluateOptions = {}
): Promise<EvaluationReport> => {
  assertValidDataset(dataset);

  const kValues = [...(options.kValues ?? DEFAULT_K_VALUES)].sort(
    (a, b) => a - b
  );
  if (kValues.length === 0) {
    throw new AppError("kValues must be non-empty", 400, "VALIDATION_ERROR");
  }
  for (const k of kValues) {
    assertValidK(k);
  }
  const maxK = Math.max(...kValues);

  const resolved = await resolveDatasetJudgments(dataset);
  const coverage = buildCoverage(resolved);
  const relevant = (j: ResolvedJudgment) => j.grade >= RELEVANT_THRESHOLD;

  const results: EvaluatedQueryResult[] = [];
  const failures: QueryFailure[] = [];

  for (const query of resolved) {
    try {
      const response = await searchDocuments(
        { q: query.text, page: 1, limit: Math.min(maxK, 50) },
        options.deps ?? {}
      );
      const retrievedIds = response.results.map((r) => r.id);

      const relevantIds = new Set(
        query.judgments.filter(relevant).map((j) => j.documentId)
      );

      const metricsByK: Record<number, KMetrics> = {};
      for (const k of kValues) {
        metricsByK[k] = computeKMetrics(retrievedIds, query.judgments, k);
      }

      results.push({
        queryId: query.id,
        text: query.text,
        retrievedIds,
        relevantJudgments: query.judgments.filter(relevant).length,
        unresolvedJudgments: query.unresolvedJudgments.length,
        mrr: reciprocalRank(retrievedIds, relevantIds),
        metricsByK,
      });
    } catch (error) {
      failures.push({
        queryId: query.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const byK: Record<number, KMetrics> = {};
  for (const k of kValues) {
    byK[k] = {
      precision: meanNullable(results.map((r) => r.metricsByK[k]?.precision ?? null)) ?? 0,
      recall: meanNullable(results.map((r) => r.metricsByK[k]?.recall ?? null)),
      f1: meanNullable(results.map((r) => r.metricsByK[k]?.f1 ?? null)),
      dcg: meanNullable(results.map((r) => r.metricsByK[k]?.dcg ?? null)) ?? 0,
      ndcg: meanNullable(results.map((r) => r.metricsByK[k]?.ndcg ?? null)),
    };
  }

  return {
    datasetVersion: dataset.version,
    evaluatedAt: new Date().toISOString(),
    kValues,
    ...(options.experiment ? { experiment: options.experiment } : {}),
    totals: {
      queries: resolved.length,
      evaluated: results.length,
      failed: failures.length,
    },
    aggregate: {
      mrr: meanNullable(results.map((r) => r.mrr)),
      byK,
    },
    queries: results,
    failures,
    coverage,
  };
};

const buildCoverage = (
  resolved: readonly {
    id: string;
    judgments: ResolvedJudgment[];
    unresolvedJudgments: unknown[];
  }[]
): CoverageReport => {
  const totalJudgments = resolved.reduce(
    (n, q) => n + q.judgments.length + q.unresolvedJudgments.length,
    0
  );
  const resolvedJudgments = resolved.reduce(
    (n, q) => n + q.judgments.length,
    0
  );
  return {
    totalJudgments,
    resolvedJudgments,
    unresolvedJudgments: totalJudgments - resolvedJudgments,
    queriesWithoutRelevant: resolved
      .filter(
        (q) => !q.judgments.some((j) => j.grade >= RELEVANT_THRESHOLD)
      )
      .map((q) => q.id),
  };
};
