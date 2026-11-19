import type { Request, Response } from "express";
import { AppError } from "../../../shared/errors/app-error.js";
import { evaluateDataset } from "../services/evaluation.service.js";
import { getExperimentPreset } from "../services/experiment.service.js";
import { EXPERIMENT_PRESETS } from "../services/experiment.service.js";
import type { RunEvaluationRequest } from "../validators/evaluation.validators.js";

export const runEvaluationController = async (
  req: Request,
  res: Response
) => {
  const body = req.body as RunEvaluationRequest;

  const preset = body.experiment
    ? getExperimentPreset(body.experiment)
    : undefined;
  if (body.experiment && !preset) {
    throw new AppError("Unknown experiment", 400, "VALIDATION_ERROR");
  }

  const report = await evaluateDataset(undefined, {
    ...(body.kValues ? { kValues: body.kValues } : {}),
    ...(preset
      ? {
          deps: { searchConfig: preset.config },
          experiment: {
            name: preset.name,
            config: { ...preset.config },
          },
        }
      : {}),
  });

  res.status(200).json({ success: true, data: { report } });
};

export const listExperimentsController = async (
  _req: Request,
  res: Response
) => {
  res.status(200).json({
    success: true,
    data: {
      experiments: EXPERIMENT_PRESETS.map((p) => ({
        name: p.name,
        description: p.description,
        config: p.config,
      })),
    },
  });
};
