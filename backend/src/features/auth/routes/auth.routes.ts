import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { env } from "../../../config/env.js";
import { AppError } from "../../../shared/errors/app-error.js";
import { authenticate } from "../../../shared/middleware/auth.middleware.js";
import { validateBody } from "../../../shared/middleware/validate.middleware.js";
import {
  loginController,
  logoutController,
  meController,
  refreshController,
  registerController,
} from "../controllers/auth.controller.js";
import {
  loginSchema,
  refreshTokenSchema,
  registerSchema,
} from "../validators/auth.validators.js";

const rateLimitHandler = (
  _req: Request,
  _res: Response,
  next: NextFunction
): void => {
  next(new AppError("Too many requests, try again later", 429, "RATE_LIMITED"));
};

/** Strict limiter for credential-bearing endpoints (brute-force protection).
    Each route gets its own instance so quotas are tracked per endpoint. */
const credentialLimiter = (): ReturnType<typeof rateLimit> =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: env.AUTH_CREDENTIAL_RATE_LIMIT,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler,
  });

/** Looser limiter for token rotation. */
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

const router = Router();

router.post(
  "/register",
  credentialLimiter(),
  validateBody(registerSchema),
  registerController
);

router.post(
  "/login",
  credentialLimiter(),
  validateBody(loginSchema),
  loginController
);

router.post(
  "/refresh",
  refreshLimiter,
  validateBody(refreshTokenSchema),
  refreshController
);

router.post(
  "/logout",
  validateBody(refreshTokenSchema),
  logoutController
);

router.get("/me", authenticate, meController);

export default router;
