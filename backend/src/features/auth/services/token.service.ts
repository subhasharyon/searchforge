import { createHash, randomUUID } from "node:crypto";
import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../../../config/env.js";
import { AppError } from "../../../shared/errors/app-error.js";
import type { UserRole } from "../../users/types/user.types.js";
import type {
  AccessTokenPayload,
  RefreshTokenPayload,
} from "../types/auth.types.js";

const ISSUER = "searchforge-api";

/** SHA-256 hash of a token. Only hashes are persisted, never raw tokens. */
export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

const TTL_UNIT_SECONDS = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
} as const;

type TtlUnit = keyof typeof TTL_UNIT_SECONDS;

/** Parse ms-style TTL strings with an explicit unit ("15m", "7d") to seconds.
    A unit is required because jsonwebtoken/`ms` interprets unitless numeric
    strings as milliseconds, which would silently diverge from this parser. */
export const ttlToSeconds = (ttl: string): number => {
  const match = /^(\d+)([smhdw])$/.exec(ttl.trim());
  if (!match?.[1]) {
    throw new Error(`Invalid token TTL: ${ttl}`);
  }
  const value = Number(match[1]);
  const unit = match[2] as TtlUnit;
  return value * TTL_UNIT_SECONDS[unit];
};

export const signAccessToken = (user: {
  id: string;
  role: UserRole;
}): string =>
  jwt.sign(
    { sub: user.id, role: user.role, type: "access" } satisfies AccessTokenPayload,
    env.JWT_ACCESS_SECRET,
    {
      algorithm: "HS256",
      expiresIn: env.JWT_ACCESS_TOKEN_TTL as SignOptions["expiresIn"],
      issuer: ISSUER,
    }
  );

export const signRefreshToken = (
  userId: string,
  family: string
): { token: string; tokenHash: string; expiresAt: Date } => {
  const token = jwt.sign(
    {
      sub: userId,
      jti: randomUUID(),
      fam: family,
      type: "refresh",
    } satisfies RefreshTokenPayload,
    env.JWT_REFRESH_SECRET,
    {
      algorithm: "HS256",
      expiresIn: env.JWT_REFRESH_TOKEN_TTL as SignOptions["expiresIn"],
      issuer: ISSUER,
    }
  );

  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(
      Date.now() + ttlToSeconds(env.JWT_REFRESH_TOKEN_TTL) * 1000
    ),
  };
};

const verifyToken = <T extends { type: string }>(
  token: string,
  secret: string,
  expectedType: T["type"],
  expiredCode: string
): T => {
  let payload: T;
  try {
    payload = jwt.verify(token, secret, {
      algorithms: ["HS256"],
      issuer: ISSUER,
    }) as T;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError("Token expired", 401, expiredCode);
    }
    throw new AppError("Invalid token", 401, "INVALID_TOKEN");
  }

  if (payload.type !== expectedType) {
    throw new AppError("Invalid token", 401, "INVALID_TOKEN");
  }

  return payload;
};

export const verifyAccessToken = (token: string): AccessTokenPayload =>
  verifyToken<AccessTokenPayload>(
    token,
    env.JWT_ACCESS_SECRET,
    "access",
    "ACCESS_TOKEN_EXPIRED"
  );

export const verifyRefreshToken = (token: string): RefreshTokenPayload =>
  verifyToken<RefreshTokenPayload>(
    token,
    env.JWT_REFRESH_SECRET,
    "refresh",
    "REFRESH_TOKEN_EXPIRED"
  );

export const newTokenFamily = (): string => randomUUID();
