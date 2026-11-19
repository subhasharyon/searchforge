import { describe, expect, it } from "vitest"

import {
  isValidDocumentId,
  safeHttpUrl,
  sanitizeReturnPath,
} from "@/lib/documents"

describe("isValidDocumentId", () => {
  it("accepts a 24-char hex ObjectId", () => {
    expect(isValidDocumentId("6afdb8d7a293b8899a11239a")).toBe(true)
    expect(isValidDocumentId("6AFDB8D7A293B8899A11239A")).toBe(true)
  })

  it("rejects malformed ids", () => {
    expect(isValidDocumentId("")).toBe(false)
    expect(isValidDocumentId("abc123")).toBe(false)
    expect(isValidDocumentId("6afdb8d7a293b8899a11239aextra")).toBe(false)
    expect(isValidDocumentId("zzzzzzzzzzzzzzzzzzzzzzzz")).toBe(false)
    expect(isValidDocumentId("6afdb8d7a293b8899a11239a?evil=1")).toBe(false)
  })
})

describe("sanitizeReturnPath", () => {
  it("keeps same-origin /search paths", () => {
    expect(sanitizeReturnPath("/search?q=react")).toBe("/search?q=react")
    expect(sanitizeReturnPath("/search")).toBe("/search")
    expect(sanitizeReturnPath("/search?q=a&category=docs&page=2")).toBe(
      "/search?q=a&category=docs&page=2"
    )
  })

  it("falls back to /search for anything else", () => {
    expect(sanitizeReturnPath("https://evil.example/x")).toBe("/search")
    expect(sanitizeReturnPath("//evil.example/x")).toBe("/search")
    expect(sanitizeReturnPath("/documents/abc")).toBe("/search")
    expect(sanitizeReturnPath("javascript:alert(1)")).toBe("/search")
    expect(sanitizeReturnPath(undefined)).toBe("/search")
    expect(sanitizeReturnPath(["/search?q=a"])).toBe("/search")
  })
})

describe("safeHttpUrl", () => {
  it("accepts http and https URLs", () => {
    expect(safeHttpUrl("https://react.dev/docs")).toBe("https://react.dev/docs")
    expect(safeHttpUrl("http://example.com/x")).toBe("http://example.com/x")
  })

  it("rejects dangerous or malformed schemes", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull()
    expect(safeHttpUrl("data:text/html,<b>x</b>")).toBeNull()
    expect(safeHttpUrl("file:///etc/passwd")).toBeNull()
    expect(safeHttpUrl("not a url")).toBeNull()
    expect(safeHttpUrl("")).toBeNull()
  })
})
