import type { NextFunction, Request, Response } from "express";
import { env } from "../../config/env.js";
import { AppError } from "../errors/app-error.js";

export const notFoundHandler = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  next(
    new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404, "NOT_FOUND")
  );
};

export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const appError =
    err instanceof AppError
      ? err
      : new AppError("Internal server error", 500, "INTERNAL_ERROR");

  if (!(err instanceof AppError) || appError.statusCode >= 500) {
    req.log.error({ err }, "Unhandled error");
  }

  res.status(appError.statusCode).json({
    success: false,
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details !== undefined ? { details: appError.details } : {}),
      ...(env.NODE_ENV !== "production" && !(err instanceof AppError)
        ? { stack: err instanceof Error ? err.stack : String(err) }
        : {}),
    },
  });
};
