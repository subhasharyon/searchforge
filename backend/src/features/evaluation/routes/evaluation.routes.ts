import { Router } from "express";
import {
  authenticate,
  authorize,
} from "../../../shared/middleware/auth.middleware.js";
import { validateBody } from "../../../shared/middleware/validate.middleware.js";
import {
  listExperimentsController,
  runEvaluationController,
} from "../controllers/evaluation.controller.js";
import { runEvaluationSchema } from "../validators/evaluation.validators.js";

const router = Router();

// Evaluation executes searches and reads the corpus: admin-only.
router.use(authenticate, authorize("admin"));

router.post(
  "/run",
  validateBody(runEvaluationSchema),
  runEvaluationController
);
router.get("/experiments", listExperimentsController);

export default router;
