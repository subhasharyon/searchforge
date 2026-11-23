import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The SDK is fully mocked - no HTTP. Verifies the adapter contract:
 * forced tool_use -> LlmAnswer mapping, citation filtering, and the
 * SDK error class -> LlmError code mapping.
 */

const createMock = vi.fn();

class APIError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message);
    this.name = "APIError";
  }
}
class RateLimitError extends APIError {
  constructor(message = "rate limited") {
    super(message, 429);
    this.name = "RateLimitError";
  }
}
class APIConnectionTimeoutError extends APIError {
  constructor(message = "timeout") {
    super(message);
    this.name = "APIConnectionTimeoutError";
  }
}

vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    static APIError = APIError;
    static RateLimitError = RateLimitError;
    static APIConnectionTimeoutError = APIConnectionTimeoutError;
    messages = { create: createMock };
    constructor(public options: unknown) {}
  }
  return { default: FakeAnthropic };
});

const { AnthropicLlmProvider } = await import(
  "../src/features/ask/services/anthropic.provider.js"
);

const provider = new AnthropicLlmProvider("sk-test", "claude-haiku-4-5", 512);

const toolUseResponse = (input: Record<string, unknown>) => ({
  content: [{ type: "tool_use", name: "answer_question", input }],
  usage: { input_tokens: 10, output_tokens: 5 },
});

describe("AnthropicLlmProvider", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("forces the answer tool and maps the structured payload", async () => {
    createMock.mockResolvedValue(
      toolUseResponse({
        status: "answered",
        answer: "Backpressure pauses writers.",
        citations: [1, 3],
      })
    );

    const out = await provider.generateAnswer({
      question: "q?",
      context: "[DOC 1] ...",
    });

    const call = createMock.mock.calls[0]![0];
    expect(call.model).toBe("claude-haiku-4-5");
    expect(call.max_tokens).toBe(512);
    expect(call.tool_choice).toEqual({
      type: "tool",
      name: "answer_question",
    });
    expect(call.tools[0].name).toBe("answer_question");

    expect(out).toEqual({
      status: "answered",
      answer: "Backpressure pauses writers.",
      citationRefs: [1, 3],
      promptTokens: 10,
      outputTokens: 5,
    });
  });

  it("filters non-positive and non-integer citation refs", async () => {
    createMock.mockResolvedValue(
      toolUseResponse({
        status: "answered",
        answer: "a",
        citations: [1, 0, -2, 1.5, "x", 4],
      })
    );
    const out = await provider.generateAnswer({ question: "q", context: "c" });
    expect(out.citationRefs).toEqual([1, 4]);
  });

  it("throws LLM_INVALID_RESPONSE (502) when no tool_use block exists", async () => {
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "hello" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await expect(
      provider.generateAnswer({ question: "q", context: "c" })
    ).rejects.toMatchObject({
      code: "LLM_INVALID_RESPONSE",
      statusCode: 502,
    });
  });

  it("throws LLM_INVALID_RESPONSE on a malformed tool payload", async () => {
    createMock.mockResolvedValue(
      toolUseResponse(null as unknown as Record<string, unknown>)
    );
    await expect(
      provider.generateAnswer({ question: "q", context: "c" })
    ).rejects.toMatchObject({ code: "LLM_INVALID_RESPONSE" });
  });

  it("maps rate limits to retryable LLM_RATE_LIMITED", async () => {
    createMock.mockRejectedValue(new RateLimitError());
    await expect(
      provider.generateAnswer({ question: "q", context: "c" })
    ).rejects.toMatchObject({
      code: "LLM_RATE_LIMITED",
      retryable: true,
    });
  });

  it("maps timeouts to retryable LLM_TIMEOUT", async () => {
    createMock.mockRejectedValue(new APIConnectionTimeoutError());
    await expect(
      provider.generateAnswer({ question: "q", context: "c" })
    ).rejects.toMatchObject({ code: "LLM_TIMEOUT", retryable: true });
  });

  it("maps 5xx API errors to retryable LLM_UNAVAILABLE, 4xx non-retryable", async () => {
    createMock.mockRejectedValueOnce(new APIError("boom", 500));
    await expect(
      provider.generateAnswer({ question: "q", context: "c" })
    ).rejects.toMatchObject({ code: "LLM_UNAVAILABLE", retryable: true });

    createMock.mockRejectedValueOnce(new APIError("bad", 400));
    await expect(
      provider.generateAnswer({ question: "q", context: "c" })
    ).rejects.toMatchObject({ code: "LLM_UNAVAILABLE", retryable: false });
  });
});
