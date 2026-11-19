/**
 * Server-side session management for SearchForge.
 *
 * The browser holds only an opaque, random session id in an HttpOnly,
 * SameSite=Lax cookie — never a JWT. Access/refresh tokens live in a
 * server-side store keyed by that id, so nothing token-shaped can leak
 * into client JavaScript, the RSC payload, or browser storage.
 *
 * The refresh-token lifecycle is handled inside the data layer rather
 * than middleware: rotating a refresh token would otherwise need a
 * Set-Cookie during RSC render (not allowed) and concurrent requests
 * could present the same rotated token twice, which the backend treats
 * as token theft (family tombstone). A per-session single-flight
 * refresh avoids that race entirely within this process.
 *
 * The store lives on globalThis so dev/prod bundles that instantiate
 * the module more than once still share one store. It is in-memory by
 * design for this milestone — a restart invalidates all sessions
 * (fail closed: users simply log in again). Cross-process races would
 * also fail closed via the backend's tombstone mechanism.
 */

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { backendRefresh } from "@/lib/api/auth"
import type { AuthResult } from "@/types/auth"
import type { PublicUser } from "@/types/auth"

export const SESSION_COOKIE = "sf_session"

/** Access tokens are refreshed this long before they actually expire. */
const TOKEN_EXPIRY_MARGIN_MS = 30_000
/** Safety cap so a leaked-cookie spray can't grow memory unboundedly. */
const MAX_SESSIONS = 10_000

export interface Session {
  user: PublicUser
  accessToken: string
  refreshToken: string
  /** Epoch ms when the access token expires. */
  accessExpiresAt: number
  /** Epoch ms beyond which the session itself is dead. */
  refreshExpiresAt: number
  /** In-flight refresh promise — concurrent callers share one rotation. */
  refreshPromise: Promise<boolean> | null
}

type SessionStore = Map<string, Session>

const globalForSessions = globalThis as unknown as {
  __sfSessions?: SessionStore
}
const sessions: SessionStore = (globalForSessions.__sfSessions ??= new Map())

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000 // backend default 7d

/** Looks up the session for the current request's cookie, if any. */
export async function getSession(): Promise<Session | null> {
  const id = (await cookies()).get(SESSION_COOKIE)?.value
  if (!id) return null
  const session = sessions.get(id)
  if (!session || session.refreshExpiresAt <= Date.now()) {
    sessions.delete(id)
    return null
  }
  return session
}

/** Performs the backend rotation. Fail-closed: destroys the session. */
async function doRefresh(
  session: Session,
  sessionId: string
): Promise<boolean> {
  try {
    const result: AuthResult = await backendRefresh(session.refreshToken)
    session.user = result.user
    session.accessToken = result.tokens.accessToken
    session.refreshToken = result.tokens.refreshToken
    session.accessExpiresAt = Date.now() + result.tokens.expiresIn * 1000
    return true
  } catch {
    sessions.delete(sessionId)
    return false
  }
}

/**
 * Returns a fresh access token for the current session, or null when the
 * user is not authenticated (no session, or refresh failed).
 *
 * Concurrent callers share one in-flight rotation via refreshPromise —
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
  const session = sessions.get(id)
  if (!session || session.refreshExpiresAt <= Date.now()) {
    sessions.delete(id)
    return null
  }

  if (
    !forceRefresh &&
    session.accessExpiresAt - Date.now() > TOKEN_EXPIRY_MARGIN_MS
  ) {
    return session.accessToken
  }

  if (!session.refreshPromise) {
    const task = doRefresh(session, id)
    session.refreshPromise = task
    void task.finally(() => {
      if (session.refreshPromise === task) {
        session.refreshPromise = null
      }
    })
  }
  return (await session.refreshPromise) ? session.accessToken : null
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
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next().value
    if (oldest) sessions.delete(oldest)
  }
  const id = crypto.randomUUID()
  const refreshExpiresAt = Date.now() + REFRESH_TOKEN_TTL_MS
  sessions.set(id, {
    user: result.user,
    accessToken: result.tokens.accessToken,
    refreshToken: result.tokens.refreshToken,
    accessExpiresAt: Date.now() + result.tokens.expiresIn * 1000,
    refreshExpiresAt,
    refreshPromise: null,
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
  if (id) sessions.delete(id)
  jar.delete(SESSION_COOKIE)
}

/** Returns the raw refresh token so logout can revoke it server-side. */
export async function getSessionRefreshToken(): Promise<string | null> {
  const id = (await cookies()).get(SESSION_COOKIE)?.value
  return id ? (sessions.get(id)?.refreshToken ?? null) : null
}

/**
 * Sanitizes a post-login `next` redirect target. Only same-origin app
 * paths are allowed — anything else falls back to /search, preventing
 * open redirects to attacker-controlled origins.
 */
export function sanitizeNextPath(value: unknown): string {
  if (typeof value === "string" && /^\/(search|documents)(\/|\?|#|$)/.test(value)) {
    return value
  }
  return "/search"
}
