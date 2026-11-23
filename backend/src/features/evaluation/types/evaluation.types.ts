/**
 * Evaluation domain types.
 *
 * Judgments are keyed by the canonical document identity (source, url) -
 * never by MongoDB _id - so a rebuilt corpus with new ids keeps the
 * dataset valid. The runner resolves identities to real document ids at
 * evaluation time and reports anything it cannot resolve.
 */

export const RELEVANCE_GRADES = [0, 1, 2, 3] as const;
export type RelevanceGrade = (typeof RELEVANCE_GRADES)[number];

export const RELEVANT_THRESHOLD: RelevanceGrade = 1;

export interface RelevanceJudgment {
  source: string;
  url: string;
  /** 0 = not relevant, 1 = marginal, 2 = relevant, 3 = highly relevant. */
  grade: RelevanceGrade;
}

export interface EvaluationQuery {
  /** Stable query identifier, e.g. "nodejs-streams". */
  id: string;
  /** The raw query text sent to the search endpoint. */
  text: string;
  judgments: RelevanceJudgment[];
}

export interface EvaluationDataset {
  version: string;
  description: string;
  queries: EvaluationQuery[];
}

/** A judgment resolved against the live corpus. */
export interface ResolvedJudgment {
  documentId: string;
  grade: RelevanceGrade;
}

export interface ResolvedQuery {
  id: string;
  text: string;
  judgments: ResolvedJudgment[];
  /** Judged identities that do not exist in the corpus. */
  unresolvedJudgments: RelevanceJudgment[];
}

export interface KMetrics {
  precision: number;
  /** null when the query has no relevant documents to recall. */
  recall: number | null;
  /** null when recall is null. */
  f1: number | null;
  dcg: number;
  /** null when there are no relevant documents (IDCG = 0). */
  ndcg: number | null;
}

export interface EvaluatedQueryResult {
  queryId: string;
  text: string;
  /** Ranked document ids as returned by the search service. */
  retrievedIds: string[];
  relevantJudgments: number;
  unresolvedJudgments: number;
  mrr: number | null;
  /** Keyed by the requested K values. */
  metricsByK: Record<number, KMetrics>;
}

export interface QueryFailure {
  queryId: string;
  error: string;
}

export interface CoverageReport {
  totalJudgments: number;
  resolvedJudgments: number;
  unresolvedJudgments: number;
  /** Queries whose corpus has no positively-judged documents. */
  queriesWithoutRelevant: string[];
}

export interface EvaluationReport {
  datasetVersion: string;
  evaluatedAt: string;
  /** Retrieval mode the report was produced with (M7.2). */
  mode?: "keyword" | "semantic" | "hybrid" | "passage";
  kValues: number[];
  experiment?: { name: string; config: Record<string, number> };
  totals: {
    queries: number;
    evaluated: number;
    failed: number;
  };
  aggregate: {
    mrr: number | null;
    byK: Record<number, KMetrics>;
  };
  queries: EvaluatedQueryResult[];
  failures: QueryFailure[];
  coverage: CoverageReport;
}
