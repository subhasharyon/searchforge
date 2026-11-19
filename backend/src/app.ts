
import express from "express";
import helmet from "helmet";
import cors from "cors";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import healthRoutes from "./features/health/routes/health.routes.js";
import authRoutes from "./features/auth/routes/auth.routes.js";
import documentRoutes from "./features/documents/routes/document.routes.js";
import crawlerRoutes from "./features/crawler/routes/crawler.routes.js";
import searchRoutes from "./features/search/routes/search.routes.js";
import evaluationRoutes from "./features/evaluation/routes/evaluation.routes.js";
import {
  errorHandler,
  notFoundHandler,
} from "./shared/middleware/error.middleware.js";

const app = express();

// Rate limiting keys on req.ip, which depends on the "trust proxy" setting.
// TRUST_PROXY (env) declares the deployment's trusted proxy topology:
//   - unset/"false" (default, local dev & direct exposure): no proxy is
//     trusted, so client-supplied X-Forwarded-For is ignored entirely;
//   - integer N: trust only the N hops closest to this app;
//   - IPs/subnets/predefined names ("loopback", "linklocal", "uniquelocal"),
//     comma-separated: trust only connections from those proxy addresses.
// "true" is rejected at env validation - it would trust arbitrary
// X-Forwarded-For values and let clients spoof their IP to evade rate limits.
export const parseTrustProxy = (
  value: string | undefined
): boolean | number | string[] => {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "false") {
    return false;
  }
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed.split(",").map((entry) => entry.trim());
};

app.set("trust proxy", parseTrustProxy(env.TRUST_PROXY));

app.use(helmet());

app.use(
  cors({
    origin: env.CORS_ORIGIN.split(",").map((origin) => origin.trim()),
    credentials: true,
  })
);

app.use(pinoHttp({ logger }));

// Document content is ingested as raw text, so the default 100kb JSON limit
// is raised to a still-bounded 1mb for technical documentation payloads.
app.use(express.json({ limit: "1mb" }));

app.use("/api/v1/health", healthRoutes);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/documents", documentRoutes);
app.use("/api/v1/crawler", crawlerRoutes);
app.use("/api/v1/search", searchRoutes);
app.use("/api/v1/evaluation", evaluationRoutes);

app.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Welcome to SearchForge API",
  });
});

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
