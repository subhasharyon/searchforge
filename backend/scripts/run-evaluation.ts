/**
 * Runs the evaluation dataset against the live search implementation.
 *
 *   npm run evaluate                baseline only
 *   npm run evaluate -- --all       baseline + every experiment preset
 *   npm run evaluate -- --exp name  single preset
 *
 * Writes a JSON report to backend/reports/eval-<timestamp>.json.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectMongoDB } from "../src/config/database.js";
import { elasticsearchClient } from "../src/config/elasticsearch.js";
import { logger } from "../src/config/logger.js";
import mongoose from "mongoose";
import { evaluateDataset } from "../src/features/evaluation/services/evaluation.service.js";
import {
  compareReports,
  EXPERIMENT_PRESETS,
} from "../src/features/evaluation/services/experiment.service.js";
import type { EvaluationReport } from "../src/features/evaluation/types/evaluation.types.js";

const args = process.argv.slice(2);
const wantAll = args.includes("--all");
const expIdx = args.indexOf("--exp");
const singlePreset = expIdx !== -1 ? args[expIdx + 1] : undefined;

const fmt = (v: number | null): string =>
  v === null ? "  n/a " : v.toFixed(4);

const printReport = (report: EvaluationReport): void => {
  const cov = report.coverage;
  console.log(`\n=== ${report.experiment?.name ?? "baseline"} ===`);
  console.log(
    `queries: ${report.totals.evaluated} evaluated, ` +
      `${report.totals.failed} failed | ` +
      `judgments: ${cov.resolvedJudgments}/${cov.totalJudgments} resolved`
  );
  if (cov.unresolvedJudgments > 0) {
    console.log(
      `  WARNING: ${cov.unresolvedJudgments} judgments unresolved (corpus gaps)`
    );
  }
  if (cov.queriesWithoutRelevant.length > 0) {
    console.log(
      `  queries with no relevant docs in corpus: ${cov.queriesWithoutRelevant.join(", ")}`
    );
  }
  console.log(`  MRR: ${fmt(report.aggregate.mrr)}`);
  for (const k of report.kValues) {
    const m = report.aggregate.byK[k];
    if (!m) continue;
    console.log(
      `  @${k}: P=${fmt(m.precision)} R=${fmt(m.recall)} ` +
        `F1=${fmt(m.f1)} NDCG=${fmt(m.ndcg)}`
    );
  }
};

const run = async (): Promise<void> => {
  await connectMongoDB();

  const baseline = await evaluateDataset();
  printReport(baseline);

  const reports: Record<string, EvaluationReport> = { baseline };

  const presets = wantAll
    ? EXPERIMENT_PRESETS.filter((p) => p.name !== "baseline")
    : singlePreset
      ? EXPERIMENT_PRESETS.filter((p) => p.name === singlePreset)
      : [];

  for (const preset of presets) {
    const report = await evaluateDataset(undefined, {
      deps: { searchConfig: preset.config },
      experiment: { name: preset.name, config: { ...preset.config } },
    });
    printReport(report);
    reports[preset.name] = report;

    const cmp = compareReports(baseline, report);
    console.log(
      `  vs baseline: MRR ${fmt(cmp.baselineMrr)} -> ${fmt(cmp.experimentMrr)}`
    );
    for (const k of baseline.kValues) {
      for (const d of cmp.byK[k] ?? []) {
        if (d.delta !== null && Math.abs(d.delta) > 1e-9) {
          console.log(
            `    ${d.metric}@${k}: ${fmt(d.baseline)} -> ${fmt(d.experiment)} (${d.delta >= 0 ? "+" : ""}${d.delta.toFixed(4)})`
          );
        }
      }
    }
  }

  const dir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../reports"
  );
  await mkdir(dir, { recursive: true });
  const file = path.join(
    dir,
    `eval-${new Date().toISOString().replaceAll(":", "-")}.json`
  );
  await writeFile(file, JSON.stringify(reports, null, 2), "utf8");
  console.log(`\nReport written to ${file}`);
};

run()
  .then(async () => {
    await mongoose.disconnect();
    await elasticsearchClient.close();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error({ err: error }, "evaluation failed");
    await mongoose.disconnect().catch(() => undefined);
    await elasticsearchClient.close().catch(() => undefined);
    process.exit(1);
  });
