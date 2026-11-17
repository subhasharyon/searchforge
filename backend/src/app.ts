
import express from "express";
import helmet from "helmet";
import cors from "cors";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import healthRoutes from "./features/health/routes/health.routes.js";
import {
  errorHandler,
  notFoundHandler,
} from "./shared/middleware/error.middleware.js";

const app = express();

app.use(helmet());

app.use(
  cors({
    origin: env.CORS_ORIGIN.split(",").map((origin) => origin.trim()),
    credentials: true,
  })
);

app.use(pinoHttp({ logger }));

app.use(express.json());

app.use("/api/v1/health", healthRoutes);

app.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Welcome to SearchForge API",
  });
});

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
