import type { Request, Response } from "express";
import { AppError } from "../../../shared/errors/app-error.js";
import {
  login,
  logout,
  refresh,
  register,
} from "../services/auth.service.js";
import type {
  LoginInput,
  RefreshTokenInput,
  RegisterInput,
} from "../validators/auth.validators.js";

export const registerController = async (req: Request, res: Response) => {
  const result = await register(req.body as RegisterInput);

  res.status(201).json({
    success: true,
    data: result,
  });
};

export const loginController = async (req: Request, res: Response) => {
  const result = await login(req.body as LoginInput);

  res.status(200).json({
    success: true,
    data: result,
  });
};

export const refreshController = async (req: Request, res: Response) => {
  const result = await refresh(req.body as RefreshTokenInput);

  res.status(200).json({
    success: true,
    data: result,
  });
};

export const logoutController = async (req: Request, res: Response) => {
  await logout(req.body as RefreshTokenInput);

  res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
};

export const meController = (req: Request, res: Response) => {
  if (!req.user) {
    // Should be unreachable - the authenticate middleware always sets it.
    throw new AppError("Unauthenticated", 401, "UNAUTHENTICATED");
  }

  res.status(200).json({
    success: true,
    data: { user: req.user },
  });
};
