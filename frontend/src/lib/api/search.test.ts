import { describe, expect, it } from "vitest"

import { buildSearchParams } from "./search"

describe("buildSearchParams", () => {
  it("encodes the query", () => {
    expect(buildSearchParams({ q: "react hooks & state" })).toBe(
      "q=react+hooks+%26+state"
    )
  })

  it("trims and drops empty queries", () => {
    expect(buildSearchParams({ q: "   " })).toBe("")
    expect(buildSearchParams({})).toBe("")
  })

  it("omits page 1 (backend default) and passes later pages", () => {
    expect(buildSearchParams({ q: "x", page: 1 })).toBe("q=x")
    expect(buildSearchParams({ q: "x", page: 3 })).toBe("q=x&page=3")
  })

  it("passes limit through", () => {
    expect(buildSearchParams({ q: "x", limit: 10 })).toBe("q=x&limit=10")
  })
})
