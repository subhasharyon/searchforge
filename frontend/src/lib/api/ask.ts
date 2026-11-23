import { authorizedJson } from "@/lib/api/authorized";
import type { AskResponse } from "@/types/ask";

/**
 * POST /api/v1/ask — grounded answer generation over passage retrieval.
 * Runs on the user's own Bearer token; the backend enforces auth,
 * a dedicated ask rate limit, and citation validation.
 */
export async function askQuestion(question: string): Promise<AskResponse> {
  return authorizedJson<AskResponse>("/api/v1/ask", {
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    },
  });
}
