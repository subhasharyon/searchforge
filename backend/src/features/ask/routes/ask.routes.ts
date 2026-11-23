import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { env } from "../../../config/env.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { authenticate } from "../../../shared/middleware/auth.middleware.js";
import { validateBody } from "../../../shared/middleware/validate.middleware.js";
import { askController } from "../controllers/ask.controller.js";
import { askSchema } from "../validators/ask.validators.js";

const rateLimitHandler = (
  _req: Request,
  _res: Response,
  next: NextFunction
): void => {
  next(new AppError("Too many requests, try again later", 429, "RATE_LIMITED"));
};

/**
 * Every ask call egresses to a paid LLM API - throttle like the
 * credential endpoints so a looped client cannot run up spend.
 */
const askLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.ASK_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

const router = Router();

router.use(authenticate);
router.post("/", askLimiter, validateBody(askSchema), askController);

export default router;
