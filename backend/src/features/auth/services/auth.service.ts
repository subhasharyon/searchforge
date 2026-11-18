import { env } from "../../../config/env.js";
import { AppError } from "../../../shared/errors/app-error.js";
import {
  userRepository,
  type UserDocument,
} from "../../users/repositories/user.repository.js";
import { toPublicUser } from "../../users/services/user.service.js";
import { refreshTokenRepository } from "../repositories/refresh-token.repository.js";
import type {
  LoginInput,
  RefreshTokenInput,
  RegisterInput,
} from "../validators/auth.validators.js";
import type { AuthResult, AuthTokens } from "../types/auth.types.js";
import { hashPassword, verifyPassword } from "./password.service.js";
import {
  hashToken,
  newTokenFamily,
  signAccessToken,
  signRefreshToken,
  ttlToSeconds,
  verifyRefreshToken,
} from "./token.service.js";

// Compared against when an account does not exist, so login response time
// does not reveal whether the email is registered.
const DUMMY_PASSWORD_HASH =
  "$2b$12$C6UzMDM.H6dfI/f/IKcEeO7ZBnDBzGkqGjcHh0LIm8PvKqsBm8rBy";

const MONGO_DUPLICATE_KEY_CODE = 11000;

const issueTokenPair = async (
  user: UserDocument,
  family: string
): Promise<AuthTokens> => {
  const refresh = signRefreshToken(user._id.toString(), family);

  await refreshTokenRepository.create({
    user: user._id,
    tokenHash: refresh.tokenHash,
    family,
    expiresAt: refresh.expiresAt,
  });

  return {
    accessToken: signAccessToken({
      id: user._id.toString(),
      role: user.role,
    }),
    refreshToken: refresh.token,
    expiresIn: ttlToSeconds(env.JWT_ACCESS_TOKEN_TTL),
  };
};

const toAuthResult = async (
  user: UserDocument,
  family: string
): Promise<AuthResult> => ({
  user: toPublicUser(user),
  tokens: await issueTokenPair(user, family),
});

export const register = async (input: RegisterInput): Promise<AuthResult> => {
  const email = input.email.toLowerCase();

  const existing = await userRepository.findByEmail(email);
  if (existing) {
    throw new AppError(
      "An account with this email already exists",
      409,
      "EMAIL_ALREADY_REGISTERED"
    );
  }

  const passwordHash = await hashPassword(input.password);

  let user: UserDocument;
  try {
    user = await userRepository.create({
      name: input.name,
      email,
      passwordHash,
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === MONGO_DUPLICATE_KEY_CODE
    ) {
      // Unique-index race between the existence check and the insert.
      throw new AppError(
        "An account with this email already exists",
        409,
        "EMAIL_ALREADY_REGISTERED"
      );
    }
    throw error;
  }

  return toAuthResult(user, newTokenFamily());
};

export const login = async (input: LoginInput): Promise<AuthResult> => {
  const user = await userRepository.findByEmailWithPassword(
    input.email.toLowerCase()
  );

  const passwordMatches = await verifyPassword(
    input.password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH
  );

  if (!user || !passwordMatches) {
    throw new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS");
  }

  if (user.status !== "active") {
    throw new AppError("Account is suspended", 403, "ACCOUNT_SUSPENDED");
  }

  return toAuthResult(user, newTokenFamily());
};

export const refresh = async (
  input: RefreshTokenInput
): Promise<AuthResult> => {
  const payload = verifyRefreshToken(input.refreshToken);
  const tokenHash = hashToken(input.refreshToken);

  // Tombstones must outlive every potentially valid token in the family.
  // Rotation uses rolling expiry (issue-time + refresh TTL), so the newest
  // legitimate token dies at detection + TTL. A straggler claimed just before
  // the tombstone lands can expire marginally later, so add a grace window
  // that comfortably exceeds any in-flight request time.
  const FAMILY_TOMBSTONE_GRACE_MS = 5 * 60 * 1000;
  const familyTombstoneExpiry = new Date(
    Date.now() +
      ttlToSeconds(env.JWT_REFRESH_TOKEN_TTL) * 1000 +
      FAMILY_TOMBSTONE_GRACE_MS
  );

  // A family tombstoned by an earlier reuse detection rejects every token
  // minted into it - including one created after the tombstone was written.
  if (await refreshTokenRepository.isFamilyRevoked(payload.fam)) {
    throw new AppError(
      "Refresh token reuse detected",
      401,
      "REFRESH_TOKEN_REUSED"
    );
  }

  const user = await userRepository.findById(payload.sub);
  if (!user) {
    await refreshTokenRepository.revokeFamily(
      payload.fam,
      familyTombstoneExpiry
    );
    throw new AppError("User not found", 401, "UNAUTHENTICATED");
  }

  if (user.status !== "active") {
    await refreshTokenRepository.revokeAllForUser(user._id);
    throw new AppError("Account is suspended", 403, "ACCOUNT_SUSPENDED");
  }

  const replacement = signRefreshToken(user._id.toString(), payload.fam);

  // Atomically claim the presented token. If two concurrent requests race,
  // only the first transitions it to revoked; the loser takes the reuse path.
  const claimed = await refreshTokenRepository.claimForRotation(
    tokenHash,
    replacement.tokenHash
  );

  if (!claimed) {
    const stored = await refreshTokenRepository.findByTokenHash(tokenHash);

    if (!stored) {
      // Validly signed but unknown to us: possibly a forged family id or a
      // token whose document was already removed. Revoke the claimed family.
      await refreshTokenRepository.revokeFamily(
        payload.fam,
        familyTombstoneExpiry
      );
      throw new AppError(
        "Invalid refresh token",
        401,
        "INVALID_REFRESH_TOKEN"
      );
    }

    if (stored.revokedAt) {
      // A rotated/revoked token was presented again - treat as token theft
      // and kill the whole rotation family.
      await refreshTokenRepository.revokeFamily(
        stored.family,
        familyTombstoneExpiry
      );
      throw new AppError(
        "Refresh token reuse detected",
        401,
        "REFRESH_TOKEN_REUSED"
      );
    }

    // The claim can only have failed on expiry at this point.
    throw new AppError("Refresh token expired", 401, "REFRESH_TOKEN_EXPIRED");
  }

  const created = await refreshTokenRepository.create({
    user: user._id,
    tokenHash: replacement.tokenHash,
    family: claimed.family,
    expiresAt: replacement.expiresAt,
  });

  // A concurrent reuse detection may have tombstoned this family between the
  // pre-check and the insert. Revoke the just-created document and refuse,
  // rather than hand out a token for a dead family.
  if (await refreshTokenRepository.isFamilyRevoked(claimed.family)) {
    created.revokedAt = new Date();
    await created.save();
    throw new AppError(
      "Refresh token reuse detected",
      401,
      "REFRESH_TOKEN_REUSED"
    );
  }

  return {
    user: toPublicUser(user),
    tokens: {
      accessToken: signAccessToken({
        id: user._id.toString(),
        role: user.role,
      }),
      refreshToken: replacement.token,
      expiresIn: ttlToSeconds(env.JWT_ACCESS_TOKEN_TTL),
    },
  };
};

/**
 * Revokes the stored record matching the presented refresh token.
 * Idempotent: unknown or already-revoked tokens still succeed so clients
 * can always log out, and a malformed token simply matches nothing.
 */
export const logout = async (input: RefreshTokenInput): Promise<void> => {
  const stored = await refreshTokenRepository.findByTokenHash(
    hashToken(input.refreshToken)
  );

  if (stored && !stored.revokedAt) {
    stored.revokedAt = new Date();
    await stored.save();
  }
};
