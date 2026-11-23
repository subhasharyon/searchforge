import type { PassageResultItem } from "../../search/types/search.types.js";

/**
 * Context construction (M7.4): turns retrieved passages into the numbered
 * document block the LLM cites from. Pure function - fully unit-testable.
 *
 * Format:
 *   [DOC 1] title="..." url="..." id="..." source="..."
 *   <doc>
 *   chunk content...
 *   </doc>
 *
 * The [DOC n] numbering is the citation contract: the model answers with
 * refs into this list and the backend maps them back to real documents.
 * <doc> delimiters mark untrusted retrieved content for the prompt.
 */

/** Per-passage content cap - a single oversized chunk cannot starve the
    rest of the context budget. */
export const PASSAGE_CONTENT_MAX_CHARS = 3_000;

/** Whole-context cap (~6K tokens) - small enough for cheap models, large
    enough for ~8 passages of technical prose. */
export const CONTEXT_MAX_CHARS = 24_000;

const docHeader = (i: number, p: PassageResultItem): string =>
  `[DOC ${i}] title=${JSON.stringify(p.title)} url=${JSON.stringify(p.url)} ` +
  `id=${JSON.stringify(p.documentId)} source=${JSON.stringify(p.source)}` +
  (p.heading ? ` section=${JSON.stringify(p.heading)}` : "");

/**
 * Renders up to `passages.length` numbered context blocks, dropping any
 * block that would exceed the total budget. Returns the rendered context
 * plus the passages that actually made it in - citations must only ever
 * resolve against the included set.
 */
export const buildContext = (
  passages: readonly PassageResultItem[]
): { context: string; included: PassageResultItem[] } => {
  const blocks: string[] = [];
  const included: PassageResultItem[] = [];
  let used = 0;

  passages.forEach((passage, i) => {
    const content =
      passage.excerpt.length > PASSAGE_CONTENT_MAX_CHARS
        ? passage.excerpt.slice(0, PASSAGE_CONTENT_MAX_CHARS)
        : passage.excerpt;
    const block = `${docHeader(i + 1, passage)}\n<doc>\n${content}\n</doc>`;
    if (used + block.length + 2 > CONTEXT_MAX_CHARS && included.length > 0) {
      return;
    }
    blocks.push(block);
    included.push(passage);
    used += block.length + 2;
  });

  return { context: blocks.join("\n\n"), included };
};
