import { describe, expect, it } from "vitest";
import {
  CHUNK_MAX_CHARS,
  CHUNK_MIN_CHARS,
  chunkDocument,
  chunkInputHash,
} from "../src/features/search/services/chunking.service.js";

describe("chunkDocument", () => {
  it("returns a single chunk for short unstructured content", () => {
    const chunks = chunkDocument("Short prose paragraph.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!).toMatchObject({
      index: 0,
      heading: "",
      content: "Short prose paragraph.",
    });
  });

  it("returns no chunks for empty content", () => {
    expect(chunkDocument("")).toHaveLength(0);
    expect(chunkDocument("   \n  ")).toHaveLength(0);
  });

  it("splits on ATX headings and records each section heading", () => {
    const content = [
      "Intro text before any heading.",
      "## Installation",
      "Run npm install first.",
      "## Usage",
      "Import the module and call it.",
    ].join("\n");

    const chunks = chunkDocument(content);
    expect(chunks.map((c) => c.heading)).toEqual([
      "",
      "Installation",
      "Usage",
    ]);
    expect(chunks[1]!.content).toContain("## Installation");
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2]);
  });

  it("never treats a heading-like line inside a code fence as a heading", () => {
    const content = [
      "## Examples",
      "```js",
      "## not a real heading",
      "const x = 1;",
      "```",
      "After the fence.",
    ].join("\n");

    const chunks = chunkDocument(content);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toContain("## not a real heading");
    expect(chunks[0]!.heading).toBe("Examples");
  });

  it("splits oversized sections on paragraph boundaries", () => {
    const paragraphs = Array.from(
      { length: 10 },
      (_, i) => `Paragraph ${i}. ${"x".repeat(900)}`
    );
    const chunks = chunkDocument(`## Big\n${paragraphs.join("\n\n")}`);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(
        CHUNK_MAX_CHARS * 1.25
      );
      expect(chunk.heading).toBe("Big");
    }
    // No paragraph is torn apart mid-way.
    const rejoined = chunks.map((c) => c.content).join("\n");
    expect(rejoined).toContain("Paragraph 0.");
    expect(rejoined).toContain("Paragraph 9.");
  });

  it("keeps a fenced code block atomic when it fits", () => {
    const content = [
      "## Code",
      "Some intro.",
      "",
      "```ts",
      "const a = 1;",
      "const b = 2;",
      "```",
      "",
      "Some outro.",
    ].join("\n");
    const chunks = chunkDocument(content);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toContain("const a = 1;\nconst b = 2;");
  });

  it("merges a tiny trailing fragment into its predecessor", () => {
    const big = "x".repeat(CHUNK_MAX_CHARS - 100);
    const content = `${"a".repeat(CHUNK_MAX_CHARS + 200)}\n\n${big}\n\ntail`;
    const chunks = chunkDocument(content);
    const last = chunks.at(-1)!;
    expect(last.content.length).toBeGreaterThanOrEqual(CHUNK_MIN_CHARS);
    // dense indices after the merge
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it("keeps short headed sections distinct - real sections are not fragments", () => {
    const content = [
      "## Install",
      "Run it.",
      "## Use",
      "Call it.",
    ].join("\n");
    const chunks = chunkDocument(content);
    expect(chunks.map((c) => c.heading)).toEqual(["Install", "Use"]);
  });

  it("is deterministic: same input produces identical chunks", () => {
    const content = `## A\n${"p ".repeat(300)}\n## B\n${"q ".repeat(300)}`;
    expect(chunkDocument(content)).toEqual(chunkDocument(content));
  });
});

describe("chunkInputHash", () => {
  it("produces a stable sha256 hex digest", () => {
    const hash = chunkInputHash("input");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(chunkInputHash("input")).toBe(hash);
    expect(chunkInputHash("other")).not.toBe(hash);
  });
});
