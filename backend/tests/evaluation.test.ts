import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { DocumentModel } from "../src/features/documents/models/document.model.js";
import { documentRepository } from "../src/features/documents/repositories/document.repository.js";
import { UserModel } from "../src/features/users/models/user.model.js";
import { searchIndexDeps } from "../src/features/search/services/es-client.provider.js";
import {
  assertValidK,
  computeKMetrics,
  dcgAtK,
  f1AtK,
  idealDcgAtK,
  meanNullable,
  ndcgAtK,
  precisionAtK,
  recallAtK,
  reciprocalRank,
} from "../src/features/evaluation/services/metrics.service.js";
import {
  assertValidDataset,
  resolveDatasetJudgments,
  validateDataset,
} from "../src/features/evaluation/services/dataset.service.js";
import { evaluateDataset } from "../src/features/evaluation/services/evaluation.service.js";
import {
  compareReports,
  EXPERIMENT_PRESETS,
  getExperimentPreset,
} from "../src/features/evaluation/services/experiment.service.js";
import { EVALUATION_DATASET } from "../src/features/evaluation/dataset/evaluation.dataset.js";
import { EVAL_CORPUS } from "../src/features/evaluation/dataset/eval-corpus.js";
import type {
  EvaluationDataset,
  EvaluationReport,
  ResolvedJudgment,
} from "../src/features/evaluation/types/evaluation.types.js";
import type {
  EsClientLike,
  EsSearchResponse,
} from "../src/features/search/types/search.types.js";
import { AppError } from "../src/shared/errors/app-error.js";
import { startTestDb, stopTestDb } from "./helpers/test-db.js";

const j = (id: string, grade: 0 | 1 | 2 | 3): ResolvedJudgment => ({
  documentId: id,
  grade,
});

/* ------------------------------------------------------------------ */
/* Metrics - hand-computed vectors                                      */
/* ------------------------------------------------------------------ */

describe("metrics", () => {
  const rel = new Set(["a", "c"]);

  it("precision@k counts relevant hits in the top-k", () => {
    const ranked = ["a", "b", "c", "d", "e"];
    expect(precisionAtK(ranked, rel, 2)).toBe(0.5); // a in [a,b]
    expect(precisionAtK(ranked, rel, 5)).toBe(0.4); // a,c in all 5
    expect(precisionAtK(ranked, rel, 1)).toBe(1); // a is first
    expect(precisionAtK(ranked, new Set(), 3)).toBe(0);
  });

  it("precision@k treats missing ranks as non-relevant", () => {
    expect(precisionAtK(["a"], rel, 5)).toBeCloseTo(0.2);
  });

  it("deduplicates ranked ids before scoring", () => {
    // Without dedup, 'a' appearing twice would inflate the hit count.
    expect(precisionAtK(["a", "a", "b"], rel, 3)).toBeCloseTo(1 / 3);
  });

  it("recall@k is hits / total relevant, null without relevant docs", () => {
    const ranked = ["a", "b", "c"];
    expect(recallAtK(ranked, rel, 3)).toBe(1); // both retrieved
    expect(recallAtK(ranked, rel, 2)).toBe(0.5); // only a in top-2
    expect(recallAtK(ranked, new Set(), 3)).toBeNull();
  });

  it("f1@k is the harmonic mean, 0 when both are 0, null w/o recall", () => {
    const ranked = ["a", "b", "c", "d"];
    // @2: P=0.5, R=0.5 -> F1=0.5
    expect(f1AtK(ranked, rel, 2)).toBeCloseTo(0.5);
    // @4: P=0.5, R=1.0 -> F1=2/3
    expect(f1AtK(ranked, rel, 4)).toBeCloseTo(2 / 3);
    expect(f1AtK(["x"], rel, 1)).toBe(0);
    expect(f1AtK(ranked, new Set(), 2)).toBeNull();
  });

  it("MRR is 1/rank of the first relevant hit", () => {
    expect(reciprocalRank(["x", "a", "c"], rel)).toBe(0.5);
    expect(reciprocalRank(["a"], rel)).toBe(1);
    // relevant exists in judgments but not retrieved -> 0
    expect(reciprocalRank(["x", "y"], rel)).toBe(0);
    // no relevant docs to be judged -> null, not a misleading 0
    expect(reciprocalRank(["x"], new Set())).toBeNull();
  });

  it("DCG@k accumulates graded gain (2^g - 1)/log2(rank+1)", () => {
    // ranked a(g3), b(unjudged->0), c(g1): 7/1 + 0 + 1/log2(4)
    const grades = new Map([
      ["a", 3],
      ["c", 1],
    ]);
    expect(dcgAtK(["a", "b", "c"], grades, 3)).toBeCloseTo(
      7 + 1 / Math.log2(4)
    );
    expect(dcgAtK([], grades, 5)).toBe(0);
  });

  it("IDCG@k sorts judged grades best-first", () => {
    const judgments = [j("a", 1), j("b", 3), j("c", 2)];
    // ideal order 3,2,1: 7 + 3/1.585 + 1/2 = 7 + 1.8928 + 0.5
    expect(idealDcgAtK(judgments, 3)).toBeCloseTo(
      7 + 3 / Math.log2(3) + 1 / Math.log2(4)
    );
  });

  it("NDCG@k is DCG/IDCG, null when no relevant judgments", () => {
    const judgments = [j("a", 3), j("c", 1)];
    const dcg = dcgAtK(["a", "c"], new Map([["a", 3], ["c", 1]]), 2);
    const expected = dcg / idealDcgAtK(judgments, 2);
    expect(ndcgAtK(["a", "c"], judgments, 2)).toBeCloseTo(expected);
    expect(ndcgAtK(["a", "c"], judgments, 2)).toBeCloseTo(1); // ideal order
    expect(ndcgAtK(["c", "a"], judgments, 2)).toBeLessThan(1);
    expect(ndcgAtK(["x"], [], 3)).toBeNull();
  });

  it("computeKMetrics returns a coherent metric bundle", () => {
    const judgments = [j("a", 3), j("c", 1)];
    const m = computeKMetrics(["a", "x", "c"], judgments, 3);
    expect(m.precision).toBeCloseTo(2 / 3);
    expect(m.recall).toBe(1);
    expect(m.ndcg).not.toBeNull();
    expect(m.ndcg!).toBeLessThanOrEqual(1);
  });

  it("rejects invalid K", () => {
    for (const k of [0, -1, 1.5, Number.NaN]) {
      expect(() => assertValidK(k)).toThrow(AppError);
      expect(() => precisionAtK([], rel, k)).toThrow(AppError);
    }
  });

  it("meanNullable averages defined values only", () => {
    expect(meanNullable([1, null, 0])).toBe(0.5);
    expect(meanNullable([null, null])).toBeNull();
    expect(meanNullable([])).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Dataset validation                                                   */
/* ------------------------------------------------------------------ */

const ds = (queries: EvaluationDataset["queries"]): EvaluationDataset => ({
  version: "t1",
  description: "test",
  queries,
});

describe("validateDataset", () => {
  it("accepts the shipped dataset", () => {
    expect(validateDataset(EVALUATION_DATASET)).toEqual([]);
  });

  it("rejects an empty dataset", () => {
    expect(validateDataset(ds([])).length).toBeGreaterThan(0);
  });

  it("rejects duplicate query ids and empty text", () => {
    const errors = validateDataset(
      ds([
        { id: "q1", text: "a", judgments: [] },
        { id: "q1", text: "b", judgments: [] },
        { id: "q2", text: "   ", judgments: [] },
      ])
    );
    expect(errors.join(" ")).toContain("duplicate query id");
    expect(errors.join(" ")).toContain("text must be non-empty");
  });

  it("rejects out-of-range grades and duplicate judgments", () => {
    const errors = validateDataset(
      ds([
        {
          id: "q1",
          text: "x",
          judgments: [
            { source: "s", url: "u1", grade: 5 as never },
            { source: "s", url: "u1", grade: 2 },
            { source: "", url: "", grade: 1 },
          ],
        },
      ])
    );
    expect(errors.join(" ")).toContain("not in 0..3");
    expect(errors.join(" ")).toContain("duplicate judgment");
    expect(errors.join(" ")).toContain("source and url");
  });

  it("assertValidDataset throws AppError on invalid data", () => {
    expect(() => assertValidDataset(ds([]))).toThrow(AppError);
  });
});

/* ------------------------------------------------------------------ */
/* Corpus resolution                                                    */
/* ------------------------------------------------------------------ */

const seedDocs = async () => {
  await DocumentModel.deleteMany({});
  await documentRepository.create({
    title: "Doc A",
    url: "https://a.example/doc",
    source: "s",
    category: "documentation",
    contentType: "html",
    content: "alpha",
    contentHash: "a".repeat(64),
  });
};

describe("resolveDatasetJudgments", () => {
  beforeAll(startTestDb);
  afterAll(stopTestDb);
  beforeEach(seedDocs);

  it("resolves existing identities and reports unresolved ones", async () => {
    const dataset = ds([
      {
        id: "q1",
        text: "x",
        judgments: [
          { source: "s", url: "https://a.example/doc", grade: 3 },
          { source: "s", url: "https://missing.example/doc", grade: 2 },
        ],
      },
    ]);
    const resolved = await resolveDatasetJudgments(dataset);
    expect(resolved[0]!.judgments).toHaveLength(1);
    expect(resolved[0]!.unresolvedJudgments).toHaveLength(1);
    expect(resolved[0]!.unresolvedJudgments[0]!.url).toBe(
      "https://missing.example/doc"
    );
    expect(resolved[0]!.judgments[0]!.documentId).toMatch(/^[0-9a-f]{24}$/);
  });
});

/* ------------------------------------------------------------------ */
/* Evaluation runner                                                    */
/* ------------------------------------------------------------------ */

const hitIds = (ids: string[]): EsSearchResponse => ({
  hits: {
    total: { value: ids.length },
    hits: ids.map((id) => ({
      _id: id,
      _score: 1,
      _source: {
        title: id,
        url: `https://x/${id}`,
        source: "s",
        category: "documentation",
        contentType: "html",
        technologies: [],
        updatedAt: "2024-01-01T00:00:00.000Z",
      },
    })),
  },
});

const clientReturning = (idsByQuery: Record<string, string[]>): EsClientLike => ({
  indices: {
    exists: async () => true,
    create: async () => ({}),
    delete: async () => ({}),
    getAlias: async () => ({}),
    existsAlias: async () => true,
    updateAliases: async () => ({}),
  },
  index: async () => ({}),
  delete: async () => ({}),
  bulk: async () => ({ errors: false, items: [] }),
  count: async () => ({ count: 0 }),
  search: async (opts) => {
    const q = ((opts.query as { bool: { must: { multi_match?: { query: string }; match_all?: unknown }[] } }).bool.must[0]
      ?.multi_match?.query) ?? "";
    return hitIds(idsByQuery[q] ?? []);
  },
});

describe("evaluateDataset", () => {
  beforeAll(startTestDb);
  afterAll(stopTestDb);
  beforeEach(seedDocs);

  it("runs queries through the search service and aggregates", async () => {
    const docA = await DocumentModel.findOne({ source: "s" });
    const idA = docA!._id.toString();

    const dataset = ds([
      {
        id: "q1",
        text: "one",
        judgments: [{ source: "s", url: "https://a.example/doc", grade: 3 }],
      },
      {
        id: "q2",
        text: "two",
        judgments: [
          { source: "s", url: "https://a.example/doc", grade: 3 },
          { source: "s", url: "https://missing.example/doc", grade: 2 },
        ],
      },
    ]);

    const client = clientReturning({ one: [idA, "other"], two: [] });
    const report = await evaluateDataset(dataset, {
      kValues: [1, 2],
      deps: { client },
    });

    expect(report.totals).toEqual({ queries: 2, evaluated: 2, failed: 0 });
    expect(report.coverage.unresolvedJudgments).toBe(1);

    const q1 = report.queries.find((r) => r.queryId === "q1")!;
    expect(q1.retrievedIds).toEqual([idA, "other"]);
    expect(q1.mrr).toBe(1);
    expect(q1.metricsByK[1]!.precision).toBe(1);
    expect(q1.metricsByK[2]!.precision).toBe(0.5);

    const q2 = report.queries.find((r) => r.queryId === "q2")!;
    // Retrieved nothing -> mrr 0 (relevant doc exists), precision 0.
    expect(q2.mrr).toBe(0);
    expect(q2.metricsByK[1]!.precision).toBe(0);
    expect(q2.metricsByK[1]!.recall).toBe(0);
    expect(q2.unresolvedJudgments).toBe(1);

    // Aggregate: q1 P@1=1, q2 P@1=0 -> 0.5; MRR = (1 + 0)/2
    expect(report.aggregate.mrr).toBe(0.5);
    expect(report.aggregate.byK[1]!.precision).toBe(0.5);
  });

  it("records failed queries instead of fabricating zero scores", async () => {
    const dataset = ds([
      {
        id: "q1",
        text: "one",
        judgments: [{ source: "s", url: "https://a.example/doc", grade: 3 }],
      },
      {
        id: "q2",
        text: "two",
        judgments: [{ source: "s", url: "https://a.example/doc", grade: 3 }],
      },
    ]);
    const inner = clientReturning({ one: [] });
    const client: EsClientLike = {
      ...inner,
      search: async (opts) => {
        const q = ((opts.query as { bool: { must: { multi_match?: { query: string } }[] } })
          .bool.must[0]?.multi_match?.query) ?? "";
        if (q === "two") {
          throw new Error("cluster gone");
        }
        return hitIds([]);
      },
    };

    const report = await evaluateDataset(dataset, {
      kValues: [1],
      deps: { client },
    });
    expect(report.totals.failed).toBe(1);
    // searchDocuments wraps backend errors as SEARCH_UNAVAILABLE.
    expect(report.failures[0]).toEqual({
      queryId: "q2",
      error: "Search backend unavailable",
    });
    expect(report.queries).toHaveLength(1);
  });

  it("rejects empty or invalid kValues", async () => {
    await expect(evaluateDataset(EVALUATION_DATASET, { kValues: [] })).rejects
      .toThrow(AppError);
    await expect(
      evaluateDataset(EVALUATION_DATASET, { kValues: [0] })
    ).rejects.toThrow(AppError);
  });
});

/* ------------------------------------------------------------------ */
/* Experiments                                                          */
/* ------------------------------------------------------------------ */

const reportWith = (mrr: number, p1: number): EvaluationReport => ({
  datasetVersion: "t",
  evaluatedAt: "2024-01-01T00:00:00.000Z",
  kValues: [1],
  totals: { queries: 1, evaluated: 1, failed: 0 },
  aggregate: {
    mrr,
    byK: { 1: { precision: p1, recall: 1, f1: p1, dcg: 1, ndcg: 1 } },
  },
  queries: [],
  failures: [],
  coverage: {
    totalJudgments: 0,
    resolvedJudgments: 0,
    unresolvedJudgments: 0,
    queriesWithoutRelevant: [],
  },
});

describe("experiments", () => {
  it("provides a baseline preset matching production defaults", () => {
    const baseline = getExperimentPreset("baseline");
    expect(baseline).toBeDefined();
    expect(baseline!.config).toEqual({
      titleBoost: 3,
      contentBoost: 1,
      technologiesBoost: 2,
    });
    expect(EXPERIMENT_PRESETS.length).toBeGreaterThanOrEqual(4);
  });

  it("compareReports computes signed per-metric deltas", () => {
    const baseline = reportWith(0.5, 0.6);
    const experiment = {
      ...reportWith(0.75, 0.8),
      experiment: { name: "title-heavy", config: { titleBoost: 6 } },
    };
    const cmp = compareReports(baseline, experiment);
    expect(cmp.experiment).toBe("title-heavy");
    expect(cmp.mrrDelta).toBeCloseTo(0.25);
    const p1 = cmp.byK[1]!.find((d) => d.metric === "precision")!;
    expect(p1.baseline).toBe(0.6);
    expect(p1.experiment).toBe(0.8);
    expect(p1.delta).toBeCloseTo(0.2);
  });

  it("compareReports yields null deltas for undefined metrics", () => {
    const baseline = reportWith(0.5, 0.6);
    baseline.aggregate.byK[1]!.recall = null;
    const experiment = reportWith(0.7, 0.7);
    const cmp = compareReports(baseline, experiment);
    const rec = cmp.byK[1]!.find((d) => d.metric === "recall")!;
    expect(rec.delta).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* API                                                                  */
/* ------------------------------------------------------------------ */

describe("POST /api/v1/evaluation/run", () => {
  let userToken = "";
  let adminToken = "";

  beforeAll(async () => {
    await startTestDb();
    const reg = async (email: string) => {
      const res = await request(app).post("/api/v1/auth/register").send({
        name: "Eval",
        email,
        password: "password1",
      });
      return res.body.data.tokens.accessToken as string;
    };
    userToken = await reg("eval-user@example.com");
    adminToken = await reg("eval-admin@example.com");
    await UserModel.updateOne(
      { email: "eval-admin@example.com" },
      { role: "admin" }
    );
    // Seed every corpus doc the shipped dataset judges.
    for (const d of EVAL_CORPUS) {
      await documentRepository.create({
        ...d,
        contentHash: "a".repeat(64),
      });
    }
  });
  afterAll(stopTestDb);

  beforeEach(async () => {
    searchIndexDeps.client = clientReturning({});
  });
  afterAll(() => {
    searchIndexDeps.client = undefined;
  });

  it("rejects unauthenticated and non-admin requests", async () => {
    const unauth = await request(app)
      .post("/api/v1/evaluation/run")
      .send({});
    expect(unauth.status).toBe(401);

    const nonAdmin = await request(app)
      .post("/api/v1/evaluation/run")
      .set({ Authorization: `Bearer ${userToken}` })
      .send({});
    expect(nonAdmin.status).toBe(403);
  });

  it("rejects invalid bodies", async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };
    for (const body of [
      { kValues: [0] },
      { kValues: [51] },
      { kValues: [1, 1] },
      { kValues: [1, 2, 3, 4, 5, 6] },
      { experiment: "nonexistent" },
      { bogus: true },
    ]) {
      const res = await request(app)
        .post("/api/v1/evaluation/run")
        .set(auth)
        .send(body);
      expect(res.status).toBe(400);
    }
  });

  it("returns a full report for an admin", async () => {
    const res = await request(app)
      .post("/api/v1/evaluation/run")
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ kValues: [1, 5] });

    expect(res.status).toBe(200);
    const report = res.body.data.report;
    expect(report.datasetVersion).toBe("1.0.0");
    expect(report.totals.queries).toBe(20);
    expect(report.kValues).toEqual([1, 5]);
    // Every dataset judgment resolved against the seeded corpus.
    expect(report.coverage.unresolvedJudgments).toBe(0);
    expect(report.aggregate.byK["1"]).toHaveProperty("precision");
  });

  it("runs a named experiment and records it in the report", async () => {
    const res = await request(app)
      .post("/api/v1/evaluation/run")
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ experiment: "title-heavy", kValues: [5] });

    expect(res.status).toBe(200);
    expect(res.body.data.report.experiment.name).toBe("title-heavy");
    expect(res.body.data.report.experiment.config.titleBoost).toBe(6);
  });

  it("lists experiment presets for admins", async () => {
    const res = await request(app)
      .get("/api/v1/evaluation/experiments")
      .set({ Authorization: `Bearer ${adminToken}` });
    expect(res.status).toBe(200);
    expect(res.body.data.experiments.length).toBeGreaterThanOrEqual(4);
    expect(
      res.body.data.experiments.some((e: { name: string }) => e.name === "baseline")
    ).toBe(true);
  });
});
