import { describe, expect, it } from "vitest"

import { highlightToHtml } from "./highlight"

describe("highlightToHtml", () => {
  it("keeps mark tags intact", () => {
    expect(highlightToHtml("Built-in <mark>React</mark> Hooks")).toBe(
      "Built-in <mark>React</mark> Hooks"
    )
  })

  it("escapes arbitrary markup in the fragment", () => {
    expect(
      highlightToHtml('<script>alert(1)</script> and <mark>safe</mark>')
    ).toBe("&lt;script&gt;alert(1)&lt;/script&gt; and <mark>safe</mark>")
  })

  it("escapes quotes and ampersands", () => {
    expect(highlightToHtml(`"quoted" & 'single'`)).toBe(
      "&quot;quoted&quot; &amp; &#39;single&#39;"
    )
  })

  it("does not unescape mark-like tags with attributes", () => {
    // "<mark onclick=...>" stays escaped; the lone "</mark>" is inert.
    expect(highlightToHtml('<mark onclick="x">hit</mark>')).toBe(
      "&lt;mark onclick=&quot;x&quot;&gt;hit</mark>"
    )
  })

  it("handles fragments without marks", () => {
    expect(highlightToHtml("plain text")).toBe("plain text")
  })
})
