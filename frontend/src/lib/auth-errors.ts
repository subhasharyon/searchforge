import { ApiError } from "@/lib/api/client"

/**
 * Maps an auth-endpoint failure to a user-safe message. Backend messages
 * are already human-readable, but codes are preferred where they carry
 * clearer meaning; internals never surface.
 */
export function authErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.kind === "network") {
      return "Can't reach the authentication service. Check that it's running and try again."
    }
    if (error.kind === "config") {
      return "Authentication isn't configured on this deployment yet."
    }
    if (error.kind === "unexpected") {
      return "The authentication service returned something unexpected. Try again."
    }
    switch (error.code) {
      case "INVALID_CREDENTIALS":
        return "Invalid email or password."
      case "EMAIL_ALREADY_REGISTERED":
        return "An account with this email already exists — try signing in instead."
      case "ACCOUNT_SUSPENDED":
        return "This account has been suspended."
      case "RATE_LIMITED":
        return "Too many attempts. Wait a few minutes and try again."
      case "VALIDATION_ERROR":
        return error.message
      default:
        return error.status === 429
          ? "Too many attempts. Wait a few minutes and try again."
          : "Something went wrong. Try again in a moment."
    }
  }
  return "Something went wrong. Try again in a moment."
}
