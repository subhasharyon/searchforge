import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiLlmProvider } from "../src/features/ask/services/gemini.provider.js";

/**
 * HTTP is fully stubbed through the injected fetchFn - verifies the
 * request contract (endpoint, key header, structured-output config),
 * JSON parsing, citation filtering, and status-code -> LlmError mapping.
 */

const makeFetch = () => vi.fn<typeof fetch>();

const provider = (fetchFn: typeof fetch) =>
  new GeminiLlmProvider(
    "gemini-2.5-flash",
    "test-key",
    "https://generativelanguage.googleapis.com/v1beta",
    512,
    5_000,
    fetchFn
  );

const okResponse = (payload: unknown) =>
  new Response(JSON.stringify(payload), { status: 200 });

const generateResponse = (text: string) =>
  okResponse({
    candidates: [
      { content: { parts: [{ text }] }, finishReason: "STOP" },
    ],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 7 },
  });

describe("GeminiLlmProvider", () => {
  let fetchMock: ReturnType<typeof makeFetch>;

  beforeEach(() => {
    fetchMock = makeFetch();
  });

  it("sends the generateContent request with key in header", async () => {
    fetchMock.mockResolvedValue(
      generateResponse(
        JSON.stringify({
          status: "answered",
          answer: "Use highWaterMark.",
          citations: [1, 2],
        })
      )
    );
    const out = await provider(fetchMock).generateAnswer({
      question: "q?",
      context: "[DOC 1] ctx",
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    );
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("test-key");
    expect(url).not.toContain("test-key");

    const body = JSON.parse(init?.body as string);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema.required).toContain(
      "citations"
    );
    expect(body.generationConfig.maxOutputTokens).toBe(512);
    expect(body.contents[0].parts[0].text).toContain("q?");

    expect(out).toEqual({
      status: "answered",
      answer: "Use highWaterMark.",
      citationRefs: [1, 2],
      promptTokens: 12,
      outputTokens: 7,
    });
  });

  it("filters non-positive and non-integer citation refs", async () => {
    fetchMock.mockResolvedValue(
      generateResponse(
        JSON.stringify({ status: "answered", answer: "a", citations: [1, 0, -3, 2.5, "x", 4] })
      )
    );
    const out = await provider(fetchMock).generateAnswer({
      question: "q",
      context: "c",
    });
    expect(out.citationRefs).toEqual([1, 4]);
  });

  it("throws LLM_INVALID_RESPONSE (502) on non-JSON output", async () => {
    fetchMock.mockResolvedValue(generateResponse("not json at all"));
    await expect(
      provider(fetchMock).generateAnswer({ question: "q", context: "c" })
    ).rejects.toMatchObject({ code: "LLM_INVALID_RESPONSE", statusCode: 502 });
  });

  it("throws LLM_INVALID_RESPONSE when no candidates exist", async () => {
    fetchMock.mockResolvedValue(okResponse({ candidates: [] }));
    await expect(
      provider(fetchMock).generateAnswer({ question: "q", context: "c" })
    ).rejects.toMatchObject({ code: "LLM_INVALID_RESPONSE" });
  });

  it("retries 429s then throws LLM_RATE_LIMITED", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 429 }));
    await expect(
      provider(fetchMock).generateAnswer({ question: "q", context: "c" })
    ).rejects.toMatchObject({ code: "LLM_RATE_LIMITED", retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("retries 5xx then throws retryable LLM_UNAVAILABLE", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 503 }));
    await expect(
      provider(fetchMock).generateAnswer({ question: "q", context: "c" })
    ).rejects.toMatchObject({ code: "LLM_UNAVAILABLE", retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry 4xx client errors", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 400 }));
    await expect(
      provider(fetchMock).generateAnswer({ question: "q", context: "c" })
    ).rejects.toMatchObject({ code: "LLM_UNAVAILABLE", retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps network failures to retryable LLM_UNAVAILABLE", async () => {
    fetchMock.mockRejectedValue(new Error("socket reset"));
    await expect(
      provider(fetchMock).generateAnswer({ question: "q", context: "c" })
    ).rejects.toMatchObject({ code: "LLM_UNAVAILABLE", retryable: true });
  });
});
