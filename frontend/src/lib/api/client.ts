/**
 * Server-only client primitives for the SearchForge backend API.
 *
 * All env vars are read lazily at call time (never at module scope) and are
 * server-only — none of them may ever use the NEXT_PUBLIC_ prefix.
 *
 * Authentication for user-facing requests lives in lib/session.ts +
 * lib/api/authorized.ts: the browser holds an opaque session cookie and
 * the user's own Bearer token is attached server-side.
 *
 * `serviceJson` below retains the service-account login for legitimate
 * server-to-server operations only (e.g. maintenance calls). User-facing
 * routes must use authorizedJson — never the service account — so the
 * backend always sees the end user's identity and permissions.
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

export async function rawFetch(
  path: string,
  init: RequestInit
): Promise<Response> {
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

export async function parseEnvelope<T>(
  res: Response,
  path: string
): Promise<T> {
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
/* Internal service-account session (system-to-server use only)        */
/* ------------------------------------------------------------------ */

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

interface ServiceSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

let serviceSession: ServiceSession | null = null;
let serviceAuthInFlight: Promise<ServiceSession> | null = null;

async function postServiceTokens(
  path: string,
  payload: unknown
): Promise<ServiceSession> {
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

async function authenticateService(): Promise<ServiceSession> {
  if (serviceAuthInFlight) {
    return serviceAuthInFlight;
  }

  serviceAuthInFlight = (async () => {
    if (serviceSession?.refreshToken) {
      try {
        serviceSession = await postServiceTokens("/api/v1/auth/refresh", {
          refreshToken: serviceSession.refreshToken,
        });
        return serviceSession;
      } catch {
        // Refresh token expired or the family was revoked — fresh login.
      }
    }
    const { email, password } = serviceCredentials();
    serviceSession = await postServiceTokens("/api/v1/auth/login", {
      email,
      password,
    });
    return serviceSession;
  })();

  try {
    return await serviceAuthInFlight;
  } finally {
    serviceAuthInFlight = null;
  }
}

async function getServiceAccessToken(): Promise<string> {
  if (
    serviceSession &&
    serviceSession.expiresAt - Date.now() > TOKEN_EXPIRY_MARGIN_MS
  ) {
    return serviceSession.accessToken;
  }
  return (await authenticateService()).accessToken;
}

/**
 * Authenticated request using the internal service account — for
 * server-to-server operations ONLY (indexing, maintenance). It bypasses
 * per-user authorization by design, so it must never back user-facing
 * pages or actions.
 */
export async function serviceJson<T>(
  path: string,
  { retry = true }: { retry?: boolean } = {}
): Promise<T> {
  const token = await getServiceAccessToken();
  const res = await rawFetch(path, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401 && retry) {
    serviceSession = null;
    return serviceJson<T>(path, { retry: false });
  }

  return parseEnvelope<T>(res, path);
}
