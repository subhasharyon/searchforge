
import type { Request, Response } from "express";
import { getHealthStatus } from "../services/health.service.js";

export const healthCheck = async (_req: Request, res: Response) => {
  const health = await getHealthStatus();

  const statusCode = health.status === "healthy" ? 200 : 503;

  res.status(statusCode).json({
    success: health.status === "healthy",
    data: health,
  });
};
