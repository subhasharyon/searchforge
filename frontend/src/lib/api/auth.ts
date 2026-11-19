/**
 * Unauthenticated calls to the backend /auth endpoints. Bearer-attached
 * calls go through lib/api/authorized.ts instead.
 */
import { parseEnvelope, rawFetch, ApiError } from "@/lib/api/client"
import type { AuthResult } from "@/types/auth"

async function postAuth<T>(path: string, payload: unknown): Promise<T> {
  const res = await rawFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  return parseEnvelope<T>(res, path).catch((error) => {
    if (error instanceof ApiError) {
      // Auth failures are expected control flow — mark them so callers can
      // distinguish "wrong password" from "service is down".
      throw new ApiError("auth", error.message, {
        status: error.status,
        code: error.code,
        cause: error,
      })
    }
    throw error
  })
}

function assertAuthResult(
  data: AuthResult | undefined
): asserts data is AuthResult {
  if (
    typeof data?.user?.id !== "string" ||
    typeof data?.tokens?.accessToken !== "string" ||
    typeof data?.tokens?.refreshToken !== "string" ||
    typeof data?.tokens?.expiresIn !== "number"
  ) {
    throw new ApiError("unexpected", "Malformed auth response")
  }
}

export async function backendLogin(
  email: string,
  password: string
): Promise<AuthResult> {
  const data = await postAuth<AuthResult>("/api/v1/auth/login", {
    email,
    password,
  })
  assertAuthResult(data)
  return data
}

export async function backendRegister(
  name: string,
  email: string,
  password: string
): Promise<AuthResult> {
  const data = await postAuth<AuthResult>("/api/v1/auth/register", {
    name,
    email,
    password,
  })
  assertAuthResult(data)
  return data
}

export async function backendRefresh(
  refreshToken: string
): Promise<AuthResult> {
  const data = await postAuth<AuthResult>("/api/v1/auth/refresh", {
    refreshToken,
  })
  assertAuthResult(data)
  return data
}

/** Idempotent server-side — unknown/revoked tokens still succeed. */
export async function backendLogout(refreshToken: string): Promise<void> {
  await postAuth<unknown>("/api/v1/auth/logout", { refreshToken })
}
