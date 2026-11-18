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
