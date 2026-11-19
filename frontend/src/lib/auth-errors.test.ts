import { describe, expect, it } from "vitest"

import { ApiError } from "@/lib/api/client"
import { authErrorMessage } from "@/lib/auth-errors"

describe("authErrorMessage", () => {
  it("maps backend auth codes to user-safe copy", () => {
    expect(
      authErrorMessage(
        new ApiError("auth", "Invalid email or password", {
          status: 401,
          code: "INVALID_CREDENTIALS",
        })
      )
    ).toBe("Invalid email or password.")

    expect(
      authErrorMessage(
        new ApiError("auth", "exists", {
          status: 409,
          code: "EMAIL_ALREADY_REGISTERED",
        })
      )
    ).toContain("already exists")

    expect(
      authErrorMessage(
        new ApiError("auth", "suspended", {
          status: 403,
          code: "ACCOUNT_SUSPENDED",
        })
      )
    ).toContain("suspended")
  })

  it("maps rate limiting and connectivity", () => {
    expect(
      authErrorMessage(
        new ApiError("auth", "Too many", { status: 429, code: "RATE_LIMITED" })
      )
    ).toContain("Too many")
    expect(
      authErrorMessage(new ApiError("http", "x", { status: 429 }))
    ).toContain("Too many")
    expect(authErrorMessage(new ApiError("network", "down"))).toContain(
      "Can't reach"
    )
    expect(authErrorMessage(new ApiError("config", "nope"))).toContain(
      "configured"
    )
  })

  it("never leaks internals for unknown errors", () => {
    const msg = authErrorMessage(new Error("stack trace internals"))
    expect(msg).not.toContain("internals")
  })
})
