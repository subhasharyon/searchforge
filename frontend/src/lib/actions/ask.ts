"use server";

import { ApiError } from "@/lib/api/client";
import { askQuestion } from "@/lib/api/ask";
import type { AskResponse } from "@/types/ask";

export interface AskFormState {
  error?: string;
  result?: AskResponse;
}

/** User-safe message for /ask failures; internals never surface. */
function askErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.kind === "network") {
      return "Can't reach the answer service. Check that it's running and try again.";
    }
    if (error.kind === "config") {
      return "The answer service isn't configured on this deployment yet.";
    }
    if (error.kind === "auth") {
      return "Your session expired — sign in again.";
    }
    switch (error.code) {
      case "RATE_LIMITED":
      case "LLM_RATE_LIMITED":
        return "Too many requests. Wait a few minutes and try again.";
      case "LLM_TIMEOUT":
        return "The answer service timed out. Try again.";
      case "LLM_UNAVAILABLE":
        return "Answer generation isn't enabled on this deployment yet.";
      case "LLM_INVALID_RESPONSE":
        return "The answer service returned something unexpected. Try again.";
      case "VALIDATION_ERROR":
        return error.message;
      default:
        return error.status === 429
          ? "Too many requests. Wait a few minutes and try again."
          : "Something went wrong. Try again in a moment.";
    }
  }
  return "Something went wrong. Try again in a moment.";
}

export async function askAction(
  _prev: AskFormState,
  formData: FormData
): Promise<AskFormState> {
  const raw = formData.get("question");
  const question = typeof raw === "string" ? raw.trim() : "";

  if (!question) {
    return { error: "Enter a question." };
  }
  if (question.length > 500) {
    return { error: "Keep the question under 500 characters." };
  }

  try {
    const result = await askQuestion(question);
    return { result };
  } catch (error) {
    return { error: askErrorMessage(error) };
  }
}
