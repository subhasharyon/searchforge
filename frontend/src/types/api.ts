/**
 * Envelope shape shared by every SearchForge API response.
 * Success: `{ success: true, data: T }`
 * Failure: `{ success: false, error: { code, message, details? } }`
 */

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** Token pair returned by /api/v1/auth/login and /api/v1/auth/refresh. */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
}
