import { describe, expect, it } from "vitest"

import {
  activeFilterCount,
  buildSearchHref,
  parseSearchParams,
} from "./search-url"

describe("parseSearchParams", () => {
  it("parses a full state", () => {
    expect(
      parseSearchParams({
        q: " elastic ",
        category: "documentation",
        source: "mdn",
        technology: "react",
        contentType: "html",
        page: "2",
        limit: "20",
      })
    ).toEqual({
      q: "elastic",
      category: "documentation",
      source: "mdn",
      technology: "react",
      contentType: "html",
      page: 2,
      limit: 20,
    })
  })

  it("drops invalid enum values instead of passing them through", () => {
    expect(
      parseSearchParams({ category: "bogus", contentType: "exe" })
    ).toEqual({})
  })

  it("drops page 1 and out-of-range limits", () => {
    expect(parseSearchParams({ page: "1" })).toEqual({})
    expect(parseSearchParams({ page: "0" })).toEqual({})
    expect(parseSearchParams({ limit: "51" })).toEqual({})
    expect(parseSearchParams({ limit: "abc" })).toEqual({})
  })

  it("takes the first value of repeated params", () => {
    expect(parseSearchParams({ q: ["a", "b"] }).q).toBe("a")
  })

  it("parses non-default modes but treats keyword and junk as absent", () => {
    expect(parseSearchParams({ q: "x", mode: "semantic" }).mode).toBe(
      "semantic"
    )
    expect(parseSearchParams({ q: "x", mode: "hybrid" }).mode).toBe("hybrid")
    expect(parseSearchParams({ q: "x", mode: "keyword" }).mode).toBeUndefined()
    expect(parseSearchParams({ q: "x", mode: "junk" }).mode).toBeUndefined()
  })
})

describe("buildSearchHref", () => {
  it("builds a full href", () => {
    expect(
      buildSearchHref({
        q: "elastic search",
        category: "documentation",
        technology: "react",
        page: 2,
        limit: 20,
      })
    ).toBe(
      "/search?q=elastic+search&category=documentation&technology=react&page=2&limit=20"
    )
  })

  it("omits defaults for a clean URL", () => {
    expect(buildSearchHref({ q: "x", page: 1, limit: 10 })).toBe("/search?q=x")
    expect(buildSearchHref({})).toBe("/search")
  })

  it("keeps non-default modes in the href and across pagination", () => {
    expect(buildSearchHref({ q: "x", mode: "semantic" })).toBe(
      "/search?q=x&mode=semantic"
    )
    expect(buildSearchHref({ q: "x", mode: "hybrid" })).toBe(
      "/search?q=x&mode=hybrid"
    )
    expect(buildSearchHref({ q: "x", mode: "semantic", page: 3 })).toBe(
      "/search?q=x&page=3&mode=semantic"
    )
    expect(buildSearchHref({ q: "x", mode: "keyword" })).toBe("/search?q=x")
  })

  it("round-trips through the parser", () => {
    const state = {
      q: "docker",
      source: "mdn",
      contentType: "markdown" as const,
      page: 3,
    }
    const href = buildSearchHref(state)
    const raw = Object.fromEntries(new URL(href, "https://x").searchParams)
    expect(parseSearchParams(raw)).toEqual(state)
  })
})

describe("activeFilterCount", () => {
  it("counts only filter params", () => {
    expect(activeFilterCount({ q: "x", page: 2 })).toBe(0)
    expect(activeFilterCount({ category: "article", source: "mdn" })).toBe(2)
  })
})
