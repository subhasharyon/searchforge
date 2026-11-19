/**
 * Server-only client for the SearchForge backend API.
 *
 * All env vars are read lazily at call time (never at module scope) and are
 * server-only — none of them may ever use the NEXT_PUBLIC_ prefix.
 *
 * The backend search API requires a Bearer access token. Since user-facing
 * auth is out of scope, the Next.js server authenticates itself with a
 * dedicated service account via the existing /auth/login + /auth/refresh
 * endpoints. Tokens are cached in module scope (one service session shared
 * by all requests), rotated per the backend's refresh-token contract, and
 * a single retry re-authenticates on 401.
 */

import type { ApiErrorBody, ApiSuccess, AuthTokens } from "@/types/api";

export type ApiErrorKind =
  | "config"
  | "auth"
  | "network"
  | "http"
  | "unexpected";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly code?: string;

  constructor(
    kind: ApiErrorKind,
    message: string,
    options?: { status?: number; code?: string; cause?: unknown }
  ) {
    super(message, { cause: options?.cause });
    this.name = "ApiError";
    this.kind = kind;
    this.status = options?.status;
    this.code = options?.code;
  }
}

const REQUEST_TIMEOUT_MS = 10_000;
/** Refresh the access token this long before it actually expires. */
const TOKEN_EXPIRY_MARGIN_MS = 30_000;

function baseUrl(): string {
  const url = process.env.SEARCH_API_URL?.trim().replace(/\/+$/, "");
  if (!url) {
    throw new ApiError("config", "SEARCH_API_URL is not configured");
  }
  return url;
}

function serviceCredentials(): { email: string; password: string } {
  const email = process.env.SEARCH_API_EMAIL?.trim();
  const password = process.env.SEARCH_API_PASSWORD;
  if (!email || !password) {
    throw new ApiError(
      "config",
      "SEARCH_API_EMAIL / SEARCH_API_PASSWORD are not configured"
    );
  }
  return { email, password };
}

async function rawFetch(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${baseUrl()}${path}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ApiError("network", "Could not reach the search API", {
      cause: error,
    });
  }
}

async function parseEnvelope<T>(res: Response, path: string): Promise<T> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(
      "unexpected",
      `Search API returned a non-JSON response (HTTP ${res.status})`,
      { status: res.status }
    );
  }

  if (!res.ok) {
    const err = body as Partial<ApiErrorBody> | undefined;
    throw new ApiError(
      "http",
      err?.error?.message ?? `Search API request failed (HTTP ${res.status})`,
      { status: res.status, code: err?.error?.code }
    );
  }

  const ok = body as Partial<ApiSuccess<T>> | undefined;
  if (ok?.success !== true || !("data" in ok)) {
    throw new ApiError(
      "unexpected",
      `Search API returned a malformed response for ${path}`
    );
  }
  return ok.data as T;
}

/* ------------------------------------------------------------------ */
/* Service-account session                                             */
/* ------------------------------------------------------------------ */

interface Session {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

let session: Session | null = null;
let authInFlight: Promise<Session> | null = null;

async function postTokens(path: string, payload: unknown): Promise<Session> {
  const res = await rawFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await parseEnvelope<{ tokens: AuthTokens }>(res, path).catch(
    (error) => {
      if (error instanceof ApiError) {
        throw new ApiError("auth", error.message, {
          status: error.status,
          code: error.code,
          cause: error,
        });
      }
      throw error;
    }
  );
  const { tokens } = data;
  if (
    typeof tokens?.accessToken !== "string" ||
    typeof tokens?.refreshToken !== "string" ||
    typeof tokens?.expiresIn !== "number"
  ) {
    throw new ApiError("unexpected", "Malformed auth token response");
  }
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + tokens.expiresIn * 1000,
  };
}

async function authenticate(): Promise<Session> {
  if (authInFlight) {
    return authInFlight;
  }

  authInFlight = (async () => {
    if (session?.refreshToken) {
      try {
        session = await postTokens("/api/v1/auth/refresh", {
          refreshToken: session.refreshToken,
        });
        return session;
      } catch {
        // Refresh token expired or the family was revoked — fall back to
        // a fresh service-account login.
      }
    }
    const { email, password } = serviceCredentials();
    session = await postTokens("/api/v1/auth/login", { email, password });
    return session;
  })();

  try {
    return await authInFlight;
  } finally {
    authInFlight = null;
  }
}

async function getAccessToken(): Promise<string> {
  if (session && session.expiresAt - Date.now() > TOKEN_EXPIRY_MARGIN_MS) {
    return session.accessToken;
  }
  return (await authenticate()).accessToken;
}

/**
 * Performs an authenticated JSON request against the backend API.
 * On a 401 the cached session is dropped and the request is retried once
 * with a freshly obtained token.
 */
export async function authorizedJson<T>(
  path: string,
  { retry = true }: { retry?: boolean } = {}
): Promise<T> {
  const token = await getAccessToken();
  const res = await rawFetch(path, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401 && retry) {
    session = null;
    return authorizedJson<T>(path, { retry: false });
  }

  return parseEnvelope<T>(res, path);
}
