import { describe, expect, it } from "vitest"

import { sanitizeNextPath } from "@/lib/session"

describe("sanitizeNextPath", () => {
  it("keeps same-origin app paths", () => {
    expect(sanitizeNextPath("/search")).toBe("/search")
    expect(sanitizeNextPath("/search?q=react&page=2")).toBe(
      "/search?q=react&page=2"
    )
    expect(sanitizeNextPath("/documents/6afdb8d7a293b8899a11239a")).toBe(
      "/documents/6afdb8d7a293b8899a11239a"
    )
    expect(sanitizeNextPath("/documents/abc?from=%2Fsearch")).toBe(
      "/documents/abc?from=%2Fsearch"
    )
    expect(sanitizeNextPath("/ask")).toBe("/ask")
  })

  it("rejects external origins and non-app paths", () => {
    expect(sanitizeNextPath("https://evil.example/x")).toBe("/search")
    expect(sanitizeNextPath("//evil.example/x")).toBe("/search")
    expect(sanitizeNextPath("javascript:alert(1)")).toBe("/search")
    expect(sanitizeNextPath("/login")).toBe("/search")
    expect(sanitizeNextPath("/admin")).toBe("/search")
    expect(sanitizeNextPath("/api/secrets")).toBe("/search")
    expect(sanitizeNextPath("/searchify")).toBe("/search")
  })

  it("rejects non-strings and empties", () => {
    expect(sanitizeNextPath(undefined)).toBe("/search")
    expect(sanitizeNextPath(null)).toBe("/search")
    expect(sanitizeNextPath("")).toBe("/search")
    expect(sanitizeNextPath(["/search"])).toBe("/search")
    expect(sanitizeNextPath(42)).toBe("/search")
  })
})
