import type { SearchRankingConfig } from "../../search/types/search.types.js";
import { DEFAULT_SEARCH_RANKING } from "../../search/services/search.service.js";
import type { EvaluationReport, KMetrics } from "../types/evaluation.types.js";

/**
 * Controlled ranking experiments. Each preset is a full SearchRankingConfig
 * injected through SearchDeps.searchConfig - the production default path
 * (DEFAULT_SEARCH_RANKING) is never mutated by an experiment run.
 */
export interface ExperimentPreset {
  name: string;
  description: string;
  config: SearchRankingConfig;
}

export const EXPERIMENT_PRESETS: ExperimentPreset[] = [
  {
    name: "baseline",
    description: "Production ranking (title^3, content^1, tech boost 2)",
    config: DEFAULT_SEARCH_RANKING,
  },
  {
    name: "title-heavy",
    description: "Stronger title boost (title^6) - favours exact-title hits",
    config: { titleBoost: 6, contentBoost: 1, technologiesBoost: 2 },
  },
  {
    name: "content-heavy",
    description: "Balanced title/content (title^2, content^2) - favours body matches",
    config: { titleBoost: 2, contentBoost: 2, technologiesBoost: 2 },
  },
  {
    name: "tech-tag-strong",
    description: "Higher technology-tag should boost (4) - favours tagged docs",
    config: { titleBoost: 3, contentBoost: 1, technologiesBoost: 4 },
  },
  {
    name: "no-tech-boost",
    description: "Removes the technologies should-clause boost (0)",
    config: { titleBoost: 3, contentBoost: 1, technologiesBoost: 0 },
  },
];

export const getExperimentPreset = (
  name: string
): ExperimentPreset | undefined =>
  EXPERIMENT_PRESETS.find((p) => p.name === name);

/* ------------------------------------------------------------------ */

const METRIC_KEYS = ["precision", "recall", "f1", "dcg", "ndcg"] as const;

export interface MetricDelta {
  metric: string;
  baseline: number | null;
  experiment: number | null;
  delta: number | null;
}

export interface ExperimentComparison {
  experiment: string;
  baselineMrr: number | null;
  experimentMrr: number | null;
  mrrDelta: number | null;
  byK: Record<number, MetricDelta[]>;
}

const delta = (a: number | null, b: number | null): number | null =>
  a === null || b === null ? null : b - a;

/**
 * Per-metric deltas between two evaluation reports produced with the
 * same dataset/kValues. Null-safe: a metric undefined on either side
 * yields a null delta rather than a misleading zero.
 */
export const compareReports = (
  baseline: EvaluationReport,
  experiment: EvaluationReport
): ExperimentComparison => {
  const byK: Record<number, MetricDelta[]> = {};

  for (const k of baseline.kValues) {
    const baseK: KMetrics | undefined = baseline.aggregate.byK[k];
    const expK: KMetrics | undefined = experiment.aggregate.byK[k];
    byK[k] = METRIC_KEYS.map((metric) => ({
      metric,
      baseline: baseK?.[metric] ?? null,
      experiment: expK?.[metric] ?? null,
      delta:
        baseK && expK ? delta(baseK[metric], expK[metric]) : null,
    }));
  }

  return {
    experiment: experiment.experiment?.name ?? "experiment",
    baselineMrr: baseline.aggregate.mrr,
    experimentMrr: experiment.aggregate.mrr,
    mrrDelta: delta(baseline.aggregate.mrr, experiment.aggregate.mrr),
    byK,
  };
};
