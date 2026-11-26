/**
 * Authenticated requests on behalf of the signed-in user.
 *
 * Reads the user's access token from the server-side session
 * (lib/session.ts) and forwards it to Express, where the authenticate
 * middleware resolves the real user identity and permissions — the
 * backend never sees a shared service identity for user-facing calls.
 */

import { headers } from "next/headers"
import {
  ApiError,
  parseEnvelope,
  rawFetch,
} from "@/lib/api/client"
import { getSessionAccessToken } from "@/lib/session"

/**
 * Performs an authenticated JSON request with the current user's token.
 * On a 401 the access token is force-refreshed once and retried; a second
 * 401 (or no session at all) surfaces as an auth-kind ApiError.
 */
export async function authorizedJson<T>(
  path: string,
  { retry = true, init = {} }: { retry?: boolean; init?: RequestInit } = {}
): Promise<T> {
  const token = await getSessionAccessToken({ forceRefresh: !retry })
  if (!token) {
    throw new ApiError("auth", "No active user session")
  }

  // Forward the real client IP so the backend's rate limiting keys on the
  // visitor, not this server's address, when the API lives on another host.
  const inbound = await headers();
  const clientIp = inbound.get("x-forwarded-for");

  const res = await rawFetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(clientIp ? { "x-forwarded-for": clientIp } : {}),
      ...init.headers,
    },
  });

  if (res.status === 401) {
    if (!retry) {
      throw new ApiError("auth", "Session expired", { status: 401 });
    }
    return authorizedJson<T>(path, { retry: false, init });
  }

  return parseEnvelope<T>(res, path);
}
