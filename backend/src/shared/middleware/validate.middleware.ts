import type { NextFunction, Request, Response } from "express";
import type { z } from "zod";
import { AppError } from "../errors/app-error.js";

export const validateBody =
  <T extends z.ZodType>(schema: T) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      next(
        new AppError(
          "Validation failed",
          400,
          "VALIDATION_ERROR",
          result.error.flatten().fieldErrors
        )
      );
      return;
    }

    req.body = result.data;
    next();
  };

/**
 * Validates req.query and replaces it with the parsed output. Express 5
 * exposes req.query as a prototype getter, so the parsed value is installed
 * as an own property that shadows it.
 */
export const validateQuery =
  <T extends z.ZodType>(schema: T) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      next(
        new AppError(
          "Validation failed",
          400,
          "VALIDATION_ERROR",
          result.error.flatten().fieldErrors
        )
      );
      return;
    }

    Object.defineProperty(req, "query", {
      value: result.data,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    next();
  };
