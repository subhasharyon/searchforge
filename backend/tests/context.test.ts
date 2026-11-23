import { describe, expect, it } from "vitest";
import {
  buildContext,
  CONTEXT_MAX_CHARS,
  PASSAGE_CONTENT_MAX_CHARS,
} from "../src/features/ask/services/context.service.js";
import type { PassageResultItem } from "../src/features/search/types/search.types.js";

const passage = (
  id: string,
  overrides: Partial<PassageResultItem> = {}
): PassageResultItem => ({
  id,
  documentId: `doc-${id}`,
  title: `Title ${id}`,
  url: `https://example.com/${id}`,
  source: "example",
  category: "documentation",
  contentType: "html",
  technologies: ["nodejs"],
  heading: "Intro",
  excerpt: `passage text ${id}`,
  score: 0.5,
  highlights: { content: [], heading: [] },
  ...overrides,
});

describe("buildContext", () => {
  it("renders numbered [DOC n] blocks with metadata headers", () => {
    const { context, included } = buildContext([
      passage("a1"),
      passage("b2", { heading: "" }),
    ]);

    expect(included).toHaveLength(2);
    expect(context).toContain('[DOC 1] title="Title a1"');
    expect(context).toContain('url="https://example.com/a1"');
    expect(context).toContain('id="doc-a1"');
    expect(context).toContain('section="Intro"');
    expect(context).toContain("[DOC 2]");
    expect(context).not.toContain('section=""');
    expect(context).toContain("<doc>\npassage text a1\n</doc>");
  });

  it("caps a single oversized passage at PASSAGE_CONTENT_MAX_CHARS", () => {
    const { context } = buildContext([
      passage("big", { excerpt: "x".repeat(PASSAGE_CONTENT_MAX_CHARS + 500) }),
    ]);

    const docBody = context.split("<doc>\n")[1]!;
    expect(docBody.length).toBeLessThanOrEqual(
      PASSAGE_CONTENT_MAX_CHARS + "\n</doc>".length
    );
  });

  it("drops passages that would exceed CONTEXT_MAX_CHARS", () => {
    const big = PASSAGE_CONTENT_MAX_CHARS; // max per passage
    const count = Math.ceil(CONTEXT_MAX_CHARS / (big + 400)) + 2;
    const passages = Array.from({ length: count }, (_, i) =>
      passage(`p${i}`, { excerpt: "y".repeat(big) })
    );

    const { context, included } = buildContext(passages);

    expect(context.length).toBeLessThanOrEqual(CONTEXT_MAX_CHARS);
    expect(included.length).toBeLessThan(passages.length);
    // Numbers stay sequential over the included set only.
    expect(context).toContain(`[DOC ${included.length}]`);
    expect(context).not.toContain(`[DOC ${included.length + 1}]`);
  });

  it("always includes the first passage even if it exceeds the budget", () => {
    const huge = passage("huge", { excerpt: "z".repeat(CONTEXT_MAX_CHARS) });
    const { included, context } = buildContext([huge]);

    expect(included).toHaveLength(1);
    expect(context).toContain("[DOC 1]");
  });

  it("returns an empty context for no passages", () => {
    const { context, included } = buildContext([]);
    expect(context).toBe("");
    expect(included).toHaveLength(0);
  });
});
