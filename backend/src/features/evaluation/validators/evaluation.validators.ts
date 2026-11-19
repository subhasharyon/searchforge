import { z } from "zod";
import { EXPERIMENT_PRESETS } from "../services/experiment.service.js";

const experimentNames = EXPERIMENT_PRESETS.map((p) => p.name) as [
  string,
  ...string[],
];

/**
 * Strict request body for POST /evaluation/run. K values are bounded
 * (1..50, max 5 distinct values) so a request cannot ask the search
 * service for an unbounded result set.
 */
export const runEvaluationSchema = z
  .strictObject({
    kValues: z
      .array(z.number().int().min(1).max(50))
      .min(1)
      .max(5)
      .optional(),
    experiment: z.enum(experimentNames).optional(),
  })
  .refine(
    (v) =>
      v.kValues === undefined ||
      new Set(v.kValues).size === v.kValues.length,
    "kValues must not contain duplicates"
  );

export type RunEvaluationRequest = z.infer<typeof runEvaluationSchema>;
