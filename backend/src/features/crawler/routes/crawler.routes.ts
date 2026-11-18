import { Router } from "express";
import {
  authenticate,
  authorize,
} from "../../../shared/middleware/auth.middleware.js";
import {
  validateBody,
  validateQuery,
} from "../../../shared/middleware/validate.middleware.js";
import {
  getRunController,
  listRunsController,
  listSourcesController,
  startCrawlController,
  stopRunController,
} from "../controllers/crawler.controller.js";
import {
  listRunsQuerySchema,
  startCrawlSchema,
} from "../validators/crawler.validators.js";

const router = Router();

// Crawl management is never public.
router.use(authenticate);

router.get("/sources", listSourcesController);
router.get("/runs", validateQuery(listRunsQuerySchema), listRunsController);
// Starting or stopping a crawl sends outbound traffic to third parties -
// restricted to admins rather than any authenticated user.
router.post(
  "/runs",
  authorize("admin"),
  validateBody(startCrawlSchema),
  startCrawlController
);
router.get("/runs/:id", getRunController);
router.post("/runs/:id/stop", authorize("admin"), stopRunController);

export default router;
