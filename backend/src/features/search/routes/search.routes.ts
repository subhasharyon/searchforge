import { Router } from "express";
import {
  authenticate,
  authorize,
} from "../../../shared/middleware/auth.middleware.js";
import { validateQuery } from "../../../shared/middleware/validate.middleware.js";
import {
  reindexController,
  searchController,
} from "../controllers/search.controller.js";
import { searchQuerySchema } from "../validators/search.validators.js";

const router = Router();

// Search is never public.
router.use(authenticate);

router.get("/", validateQuery(searchQuerySchema), searchController);

// Reindexing is a heavyweight admin operation (full index rebuild).
router.post("/reindex", authorize("admin"), reindexController);

export default router;
