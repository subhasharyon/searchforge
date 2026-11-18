import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { verifyAccessToken } from "../../features/auth/services/token.service.js";
import { userRepository } from "../../features/users/repositories/user.repository.js";
import { toPublicUser } from "../../features/users/services/user.service.js";
import type { UserRole } from "../../features/users/types/user.types.js";

/**
 * Authenticates a request via `Authorization: Bearer <access token>` and
 * loads the user fresh from the database so status changes (e.g. suspension)
 * take effect immediately rather than at token expiry.
 */
export const authenticate = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ")
      ? header.slice("Bearer ".length).trim()
      : undefined;

    if (!token) {
      throw new AppError(
        "Missing or malformed Authorization header",
        401,
        "UNAUTHENTICATED"
      );
    }

    const payload = verifyAccessToken(token);
    const user = await userRepository.findById(payload.sub);

    if (!user) {
      throw new AppError("User not found", 401, "UNAUTHENTICATED");
    }

    if (user.status !== "active") {
      throw new AppError("Account is suspended", 403, "ACCOUNT_SUSPENDED");
    }

    req.user = toPublicUser(user);
    next();
  } catch (error) {
    next(error);
  }
};

export const authorize =
  (...roles: UserRole[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError("Unauthenticated", 401, "UNAUTHENTICATED"));
      return;
    }

    if (!roles.includes(req.user.role)) {
      next(
        new AppError("Insufficient permissions", 403, "FORBIDDEN")
      );
      return;
    }

    next();
  };
