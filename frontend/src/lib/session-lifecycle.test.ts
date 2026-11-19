import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AuthResult } from "@/types/auth"

/**
 * Drives the real session store through a fake cookie jar and a mocked
 * backend refresh — exercises token freshness, single-flight rotation,
 * failure handling and destruction without a live server.
 */

const jar = new Map<string, string>()
const cookieApi = {
  get: (name: string) =>
    jar.has(name) ? { name, value: jar.get(name) } : undefined,
  set: (name: string, value: string) => {
    jar.set(name, value)
  },
  delete: (name: string) => {
    jar.delete(name)
  },
}

const backendRefreshMock = vi.fn()

vi.mock("next/headers", () => ({
  cookies: async () => cookieApi,
}))

vi.mock("@/lib/api/auth", () => ({
  backendRefresh: (...args: unknown[]) => backendRefreshMock(...args),
}))

const {
  createSession,
  destroySession,
  getSession,
  getSessionAccessToken,
} = await import("@/lib/session")

function authResult(userId: string, tag: string): AuthResult {
  return {
    user: {
      id: userId,
      name: "T",
      email: "t@example.com",
      role: "user",
      status: "active",
      createdAt: "",
      updatedAt: "",
    },
    tokens: {
      accessToken: `access-${tag}`,
      refreshToken: `refresh-${tag}`,
      expiresIn: 900,
    },
  }
}

beforeEach(() => {
  jar.clear()
  backendRefreshMock.mockReset()
})

describe("session lifecycle", () => {
  it("returns null token when no session cookie exists", async () => {
    expect(await getSessionAccessToken()).toBeNull()
    expect(await getSession()).toBeNull()
  })

  it("creates a session and serves the fresh access token", async () => {
    await createSession(authResult("u1", "a"))
    expect(jar.get("sf_session")).toBeTruthy()
    expect((await getSession())?.user.id).toBe("u1")
    expect(await getSessionAccessToken()).toBe("access-a")
    expect(backendRefreshMock).not.toHaveBeenCalled()
  })

  it("refreshes once for many concurrent callers (single-flight)", async () => {
    await createSession(authResult("u2", "stale"))
    const session = await getSession()
    expect(session).toBeTruthy()
    session!.accessExpiresAt = Date.now() - 1000 // force staleness

    backendRefreshMock.mockResolvedValue(authResult("u2", "fresh"))
    const results = await Promise.all(
      Array.from({ length: 5 }, () => getSessionAccessToken())
    )
    expect(results).toEqual(Array(5).fill("access-fresh"))
    expect(backendRefreshMock).toHaveBeenCalledTimes(1)
    expect(backendRefreshMock).toHaveBeenCalledWith("refresh-stale")
    expect(session!.refreshToken).toBe("refresh-fresh")
  })

  it("destroys the session when refresh fails (fail closed)", async () => {
    await createSession(authResult("u3", "doomed"))
    const session = await getSession()
    session!.accessExpiresAt = Date.now() - 1000

    backendRefreshMock.mockRejectedValue(new Error("401"))
    expect(await getSessionAccessToken()).toBeNull()
    expect(await getSession()).toBeNull()
  })

  it("expires sessions past the refresh window", async () => {
    await createSession(authResult("u4", "old"))
    const session = await getSession()
    session!.refreshExpiresAt = Date.now() - 1
    expect(await getSession()).toBeNull()
    expect(await getSessionAccessToken()).toBeNull()
  })

  it("destroySession removes store entry and cookie", async () => {
    await createSession(authResult("u5", "bye"))
    expect(await getSession()).toBeTruthy()
    await destroySession()
    expect(jar.get("sf_session")).toBeUndefined()
    expect(await getSession()).toBeNull()
  })

  it("forceRefresh rotates even when the token looks fresh", async () => {
    await createSession(authResult("u6", "looks-fresh"))
    backendRefreshMock.mockResolvedValue(authResult("u6", "rotated"))
    expect(await getSessionAccessToken({ forceRefresh: true })).toBe(
      "access-rotated"
    )
  })
})
