/**
 * Server-side session management for SearchForge.
 *
 * The browser holds only an opaque, random session id in an HttpOnly,
 * SameSite=Lax cookie — never a JWT. Access/refresh tokens live in a
 * server-side store keyed by that id, so nothing token-shaped can leak
 * into client JavaScript, the RSC payload, or browser storage.
 *
 * Store backend: Redis when REDIS_URL is configured (survives restarts
 * and is shared across instances), otherwise a process-local Map —
 * a restart then invalidates all sessions (fail closed: users simply
 * log in again).
 *
 * The refresh-token lifecycle is handled inside the data layer rather
 * than middleware: rotating a refresh token would otherwise need a
 * Set-Cookie during RSC render (not allowed) and concurrent requests
 * could present the same rotated token twice, which the backend treats
 * as token theft (family tombstone). A per-process single-flight
 * refresh avoids that race within one instance; cross-instance
 * concurrent refreshes can still race, and the backend tombstone fails
 * closed in that case (documented single-instance caveat).
 */

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { backendRefresh } from "@/lib/api/auth"
import { getRedis } from "@/lib/redis"
import type { AuthResult } from "@/types/auth"
import type { PublicUser } from "@/types/auth"

export const SESSION_COOKIE = "sf_session"

/** Access tokens are refreshed this long before they actually expire. */
const TOKEN_EXPIRY_MARGIN_MS = 30_000
/** Safety cap for the in-memory fallback (a leaked-cookie spray can't
    grow memory unboundedly); Redis enforces TTLs instead. */
const MAX_SESSIONS = 10_000

export interface Session {
  user: PublicUser
  accessToken: string
  refreshToken: string
  /** Epoch ms when the access token expires. */
  accessExpiresAt: number
  /** Epoch ms beyond which the session itself is dead. */
  refreshExpiresAt: number
}

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000 // backend default 7d

/* ------------------------------------------------------------------ */
/* Session persistence backends                                        */
/* ------------------------------------------------------------------ */

interface SessionBackend {
  get(id: string): Promise<Session | null>
  set(id: string, session: Session): Promise<void>
  delete(id: string): Promise<void>
}

const memoryBackend = (): SessionBackend => {
  const globalForSessions = globalThis as unknown as {
    __sfSessions?: Map<string, Session>
  }
  const sessions = (globalForSessions.__sfSessions ??= new Map())
  return {
    get: async (id) => sessions.get(id) ?? null,
    set: async (id, session) => {
      if (sessions.size >= MAX_SESSIONS && !sessions.has(id)) {
        const oldest = sessions.keys().next().value
        if (oldest) sessions.delete(oldest)
      }
      sessions.set(id, session)
    },
    delete: async (id) => {
      sessions.delete(id)
    },
  }
}

const redisBackend = (): SessionBackend => {
  const redis = getRedis()
  if (!redis) {
    return memoryBackend()
  }
  const key = (id: string) => `sf:session:${id}`
  return {
    get: async (id) => {
      const raw = await redis.get(key(id))
      if (!raw) return null
      try {
        return JSON.parse(raw) as Session
      } catch {
        await redis.del(key(id)).catch(() => undefined)
        return null
      }
    },
    set: async (id, session) => {
      const ttl = Math.max(session.refreshExpiresAt - Date.now(), 0)
      await redis.set(key(id), JSON.stringify(session), "PX", ttl)
    },
    delete: async (id) => {
      await redis.del(key(id))
    },
  }
}

let backend: SessionBackend | null = null
const getBackend = (): SessionBackend => (backend ??= redisBackend())

/** Per-process refresh single-flight: concurrent callers share one
    in-flight rotation so two requests can never present the same
    rotated refresh token twice. Lives outside the backend — a promise
    is not serializable state. */
const globalForRefresh = globalThis as unknown as {
  __sfRefresh?: Map<string, Promise<boolean>>
}
const inFlight = (globalForRefresh.__sfRefresh ??= new Map())

/** Reads a session record, expiring it eagerly. */
const loadSession = async (id: string): Promise<Session | null> => {
  try {
    const session = await getBackend().get(id)
    if (!session || session.refreshExpiresAt <= Date.now()) {
      await getBackend().delete(id).catch(() => undefined)
      return null
    }
    return session
  } catch (error) {
    // Store failure degrades to "not signed in" (fail closed) rather
    // than a 500 on every protected page.
    console.error("session store read failed", error)
    return null
  }
}

/** Looks up the session for the current request's cookie, if any. */
export async function getSession(): Promise<Session | null> {
  const id = (await cookies()).get(SESSION_COOKIE)?.value
  if (!id) return null
  return loadSession(id)
}

/** Performs the backend rotation. Fail-closed: destroys the session. */
async function doRefresh(
  session: Session,
  sessionId: string
): Promise<boolean> {
  try {
    const result: AuthResult = await backendRefresh(session.refreshToken)
    const updated: Session = {
      user: result.user,
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
      accessExpiresAt: Date.now() + result.tokens.expiresIn * 1000,
      refreshExpiresAt: session.refreshExpiresAt,
    }
    await getBackend().set(sessionId, updated)
    session.user = updated.user
    session.accessToken = updated.accessToken
    session.refreshToken = updated.refreshToken
    session.accessExpiresAt = updated.accessExpiresAt
    return true
  } catch {
    await getBackend().delete(sessionId).catch(() => undefined)
    return false
  }
}

/**
 * Returns a fresh access token for the current session, or null when the
 * user is not authenticated (no session, or refresh failed).
 *
 * Concurrent callers share one in-flight rotation via the inFlight map —
 * two requests presenting the same rotated refresh token would trip the
 * backend's theft detection (family tombstone). The task clears its own
 * reference (identity-checked) so a waiter can never wipe a newer
 * rotation started after the first completed.
 */
export async function getSessionAccessToken(
  { forceRefresh = false }: { forceRefresh?: boolean } = {}
): Promise<string | null> {
  const id = (await cookies()).get(SESSION_COOKIE)?.value
  if (!id) return null
  const session = await loadSession(id)
  if (!session) return null

  if (
    !forceRefresh &&
    session.accessExpiresAt - Date.now() > TOKEN_EXPIRY_MARGIN_MS
  ) {
    return session.accessToken
  }

  let task = inFlight.get(id)
  if (!task) {
    task = doRefresh(session, id)
    inFlight.set(id, task)
    void task.finally(() => {
      if (inFlight.get(id) === task) {
        inFlight.delete(id)
      }
    })
  }
  return (await task) ? session.accessToken : null
}

/**
 * Route guard for protected pages. Redirects to /login (preserving the
 * intended destination in `next`) when no valid session exists, and
 * proactively rotates a stale access token so data fetches hit the API
 * with a fresh Bearer rather than tripping a 401.
 */
export async function requireSession(next: string): Promise<Session> {
  const session = await getSession()
  if (session) {
    const token = await getSessionAccessToken()
    if (token) {
      return session
    }
  }
  redirect(`/login?next=${encodeURIComponent(next)}`)
}

/** Creates a session + cookie. Call only inside a server action. */
export async function createSession(result: AuthResult): Promise<void> {
  const id = crypto.randomUUID()
  await getBackend().set(id, {
    user: result.user,
    accessToken: result.tokens.accessToken,
    refreshToken: result.tokens.refreshToken,
    accessExpiresAt: Date.now() + result.tokens.expiresIn * 1000,
    refreshExpiresAt: Date.now() + REFRESH_TOKEN_TTL_MS,
  })
  ;(await cookies()).set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(REFRESH_TOKEN_TTL_MS / 1000),
  })
}

/**
 * Destroys the current session locally. The backend logout call is left
 * to the caller (it needs the refresh token before deletion).
 * Call only inside a server action or route handler.
 */
export async function destroySession(): Promise<void> {
  const jar = await cookies()
  const id = jar.get(SESSION_COOKIE)?.value
  if (id) await getBackend().delete(id).catch(() => undefined)
  jar.delete(SESSION_COOKIE)
}

/** Returns the raw refresh token so logout can revoke it server-side. */
export async function getSessionRefreshToken(): Promise<string | null> {
  const id = (await cookies()).get(SESSION_COOKIE)?.value
  return id ? (await getSession())?.refreshToken ?? null : null
}

/**
 * Sanitizes a post-login `next` redirect target. Only same-origin app
 * paths are allowed — anything else falls back to /search, preventing
 * open redirects to attacker-controlled origins.
 */
export function sanitizeNextPath(value: unknown): string {
  if (typeof value === "string" && /^\/(search|documents|ask)(\/|\?|#|$)/.test(value)) {
    return value
  }
  return "/search"
}
