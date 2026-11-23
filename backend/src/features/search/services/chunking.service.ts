/**
 * Structure-aware document chunking.
 *
 * Pure function: same input always produces the same chunk list, which is
 * what makes ES chunk _ids (`{docId}:{index}`) deterministic and re-indexing
 * idempotent.
 *
 * Strategy:
 *   1. Split on ATX headings (##/###/…) -> sections. A line is never a
 *      heading inside a fenced code block.
 *   2. Oversized sections split on paragraph boundaries (blank lines),
 *      then on line boundaries as a last resort.
 *   3. Fenced code blocks are atomic - a ``` block is never split by
 *      paragraph or heading logic (only by the hard max-length fallback).
 *   4. Tiny trailing chunks merge forward so no fragment under
 *      CHUNK_MIN_CHARS is left dangling.
 *
 * No overlap: chunk boundaries stay clean for dedup and future
 * contextualized-embedding support (Voyage recommends non-overlapping
 * chunks).
 */

import { createHash } from "node:crypto";

export interface DocumentChunk {
  /** 0-based position within the document - part of the ES _id. */
  index: number;
  /** Chunk text including the section heading line, if any. */
  content: string;
  /** Nearest heading text (marks stripped), "" when none. */
  heading: string;
  /** Internal: true when this chunk is a fragment produced by splitting
      an oversized section (as opposed to a whole section). Continuation
      fragments are merge candidates; real sections are not. */
  continued?: boolean;
}

/** ~1000 tokens - well inside voyage-4's per-input limits and a good
    balance between passage precision and context completeness. */
export const CHUNK_MAX_CHARS = 4_000;
/** Chunks below this merge forward instead of standing alone. */
export const CHUNK_MIN_CHARS = 150;

/** SHA-256 of a chunk's embedding input - recorded as
    `embeddedContentHash` so drift between stored chunk vectors and the
    current embedding input is detectable, mirroring document-level
    staleness tracking. */
export const chunkInputHash = (embeddingInput: string): string =>
  createHash("sha256").update(embeddingInput, "utf8").digest("hex");

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;

interface Section {
  heading: string;
  text: string;
}

/**
 * Splits content into heading-delimited sections. Text before the first
 * heading becomes a section with `heading: ""`. Lines inside fenced code
 * blocks can never be headings.
 */
const splitSections = (content: string): Section[] => {
  const sections: Section[] = [];
  let current: Section = { heading: "", text: "" };
  let inFence = false;

  for (const line of content.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
    }
    const heading = inFence ? null : HEADING_RE.exec(line);
    if (heading) {
      if (current.text.trim().length > 0) {
        sections.push(current);
      }
      current = { heading: heading[2] ?? "", text: `${line}\n` };
    } else {
      current.text += `${line}\n`;
    }
  }
  if (current.text.trim().length > 0) {
    sections.push(current);
  }
  return sections;
};

/**
 * Splits a long section into blocks on paragraph boundaries (blank lines).
 * A fenced code block is treated as a single block; a lone block that still
 * exceeds CHUNK_MAX_CHARS is hard-split on line boundaries.
 */
const splitOversizedSection = (text: string): string[] => {
  const blocks: string[] = [];
  let fence: string[] | null = null;
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks.push(paragraph.join("\n"));
      paragraph = [];
    }
  };

  for (const line of text.split("\n")) {
    if (fence !== null) {
      fence.push(line);
      if (line.trimStart().startsWith("```")) {
        blocks.push(fence.join("\n"));
        fence = null;
      }
      continue;
    }
    if (line.trimStart().startsWith("```")) {
      flushParagraph();
      fence = [line];
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      continue;
    }
    paragraph.push(line);
  }
  if (fence !== null) {
    blocks.push(fence.join("\n"));
  }
  flushParagraph();

  // Pack blocks greedily under the max; hard-split any single oversized
  // block on line boundaries.
  const chunks: string[] = [];
  let acc = "";
  const hardSplit = (block: string): string[] => {
    const pieces: string[] = [];
    let piece = "";
    for (const line of block.split("\n")) {
      if (piece.length + line.length + 1 > CHUNK_MAX_CHARS && piece !== "") {
        pieces.push(piece);
        piece = "";
      }
      piece += `${line}\n`;
    }
    if (piece !== "") {
      pieces.push(piece);
    }
    return pieces;
  };

  for (const block of blocks) {
    if (block.length > CHUNK_MAX_CHARS) {
      if (acc !== "") {
        chunks.push(acc);
        acc = "";
      }
      chunks.push(...hardSplit(block));
      continue;
    }
    if (acc !== "" && acc.length + block.length + 2 > CHUNK_MAX_CHARS) {
      chunks.push(acc);
      acc = "";
    }
    acc += `${block}\n\n`;
  }
  if (acc !== "") {
    chunks.push(acc);
  }
  return chunks;
};

/**
 * Chunks a document into ordered, searchable passages. Always returns at
 * least one chunk for non-empty content.
 */
export const chunkDocument = (content: string): DocumentChunk[] => {
  const chunks: DocumentChunk[] = [];
  let index = 0;
  const push = (
    content: string,
    heading: string,
    continued = false
  ): void => {
    const trimmed = content.trim();
    if (trimmed.length > 0) {
      chunks.push({ index: index++, content: trimmed, heading, continued });
    }
  };

  for (const section of splitSections(content)) {
    if (section.text.trim().length <= CHUNK_MAX_CHARS) {
      push(section.text, section.heading);
    } else {
      for (const piece of splitOversizedSection(section.text)) {
        push(piece, section.heading, true);
      }
    }
  }

  // Merge an undersized CONTINUATION tail into its predecessor when the
  // combined size stays reasonable (1.25x the max). Real sections keep
  // their identity however short they are - only split fragments merge.
  for (;;) {
    const tail = chunks.at(-1);
    const prev = chunks.at(-2);
    if (
      tail === undefined ||
      prev === undefined ||
      tail.continued !== true ||
      tail.content.length >= CHUNK_MIN_CHARS ||
      prev.content.length + tail.content.length > CHUNK_MAX_CHARS * 1.25
    ) {
      break;
    }
    chunks.pop();
    prev.content = `${prev.content}\n\n${tail.content}`;
  }

  // Re-number after merges so chunk_index is always a dense 0..n-1.
  chunks.forEach((chunk, i) => {
    chunk.index = i;
  });
  return chunks;
};
