import { Router } from "express";
import { authenticate } from "../../../shared/middleware/auth.middleware.js";
import {
  validateBody,
  validateQuery,
} from "../../../shared/middleware/validate.middleware.js";
import {
  createDocumentController,
  deleteDocumentController,
  getDocumentController,
  ingestDocumentController,
  lookupDocumentController,
  updateDocumentController,
} from "../controllers/document.controller.js";
import {
  createDocumentSchema,
  lookupQuerySchema,
  updateDocumentSchema,
} from "../validators/document.validators.js";

const router = Router();

// All document endpoints require authentication.
router.use(authenticate);

// "/lookup" must be registered before "/:id" or it would be captured as an
// id parameter.
router.get(
  "/lookup",
  validateQuery(lookupQuerySchema),
  lookupDocumentController
);
router.post("/", validateBody(createDocumentSchema), createDocumentController);
router.post(
  "/ingest",
  validateBody(createDocumentSchema),
  ingestDocumentController
);
router.get("/:id", getDocumentController);
router.patch("/:id", validateBody(updateDocumentSchema), updateDocumentController);
router.delete("/:id", deleteDocumentController);

export default router;
