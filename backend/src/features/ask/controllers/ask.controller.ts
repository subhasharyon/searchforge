import type { Request, Response } from "express";
import { askQuestion } from "../services/ask.service.js";
import type { AskQuery } from "../types/ask.types.js";

export const askController = async (req: Request, res: Response) => {
  // validateBody has already parsed and stored the payload.
  const body = req.body as AskQuery;
  const response = await askQuestion(body);

  res.status(200).json({ success: true, data: response });
};
