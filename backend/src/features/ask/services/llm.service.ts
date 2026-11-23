import { env } from "../../../config/env.js";
import { createAnthropicProvider } from "./anthropic.provider.js";
import { createGeminiProvider } from "./gemini.provider.js";
import { llmDeps, type LlmProvider } from "./llm.provider.js";

let defaultProvider: LlmProvider | null | undefined;

const buildProvider = (): LlmProvider | null => {
  switch (env.LLM_PROVIDER) {
    case "disabled":
      return null;
    case "anthropic":
      return createAnthropicProvider();
    case "gemini":
      return createGeminiProvider();
  }
};

/**
 * The configured answer-generation provider, or null when
 * LLM_PROVIDER=disabled. Misconfiguration fails loudly on first
 * resolution - an explicit error beats a silently missing provider.
 */
export const getLlmProvider = (): LlmProvider | null => {
  if (llmDeps.provider !== undefined) {
    return llmDeps.provider;
  }
  if (defaultProvider === undefined) {
    defaultProvider = buildProvider();
  }
  return defaultProvider;
};
