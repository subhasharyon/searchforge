import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import { env } from "../src/config/env.js";
import { UserModel } from "../src/features/users/models/user.model.js";
import { RefreshTokenModel } from "../src/features/auth/models/refresh-token.model.js";
import {
  signRefreshToken,
  ttlToSeconds,
} from "../src/features/auth/services/token.service.js";
import { refreshTokenRepository } from "../src/features/auth/repositories/refresh-token.repository.js";
import { RevokedTokenFamilyModel } from "../src/features/auth/models/revoked-token-family.model.js";
import { startTestDb, stopTestDb } from "./helpers/test-db.js";

beforeAll(startTestDb);
afterAll(stopTestDb);

beforeEach(async () => {
  // deleteMany preserves indexes (unlike dropDatabase)
  await UserModel.deleteMany({});
  await RefreshTokenModel.deleteMany({});
});

const VALID_USER = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  password: "analytical3ngine",
};

const registerUser = (overrides: Partial<typeof VALID_USER> = {}) =>
  request(app)
    .post("/api/v1/auth/register")
    .send({ ...VALID_USER, ...overrides });

const loginUser = (overrides: Partial<typeof VALID_USER> = {}) =>
  request(app)
    .post("/api/v1/auth/login")
    .send({
      email: VALID_USER.email,
      password: VALID_USER.password,
      ...overrides,
    });

describe("POST /api/v1/auth/register", () => {
  it("registers a user and returns tokens without sensitive fields", async () => {
    const res = await registerUser({ email: "ADA@Example.COM" });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const { user, tokens } = res.body.data;
    expect(user).toMatchObject({
      name: VALID_USER.name,
      email: "ada@example.com", // normalized
      role: "user",
      status: "active",
    });
    expect(tokens.accessToken).toBeTypeOf("string");
    expect(tokens.refreshToken).toBeTypeOf("string");

    // No sensitive material in the response
    expect(res.text).not.toContain("passwordHash");
    expect(res.text).not.toContain(VALID_USER.password);
    expect(res.text).not.toContain("tokenHash");

    // Password is hashed, not stored in plaintext
    const stored = await UserModel.findOne({ email: "ada@example.com" }).select(
      "+passwordHash"
    );
    expect(stored?.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it("rejects duplicate registration (case-insensitive email)", async () => {
    await registerUser();

    const res = await registerUser({ email: "ADA@example.com" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_ALREADY_REGISTERED");
  });

  it("rejects invalid payloads", async () => {
    const res = await registerUser({ password: "short" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("accepts a password of exactly 72 UTF-8 bytes (multibyte)", async () => {
    // 69 + 1 = 70 ASCII bytes + 2-byte 'é' = 72 bytes total, 71 characters.
    const password = `${"a".repeat(69)}1é`;

    const res = await registerUser({ email: "unicode72@example.com", password });

    expect(res.status).toBe(201);
  });

  it("rejects passwords over 72 UTF-8 bytes despite a valid char count", async () => {
    // 70 + 1 = 71 ASCII bytes + 2-byte 'é' = 73 bytes, only 72 characters.
    const tooLong = `${"a".repeat(70)}1é`;
    // 68 + 1 = 69 ASCII bytes + 4-byte emoji = 73 bytes, only 70 characters.
    const emojiTooLong = `${"a".repeat(68)}1😀`;

    for (const password of [tooLong, emojiTooLong]) {
      const res = await registerUser({ password });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
  });
});

describe("POST /api/v1/auth/login", () => {
  beforeEach(async () => {
    await registerUser();
  });

  it("logs in with correct credentials", async () => {
    const res = await loginUser();

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe("ada@example.com");
    expect(res.body.data.tokens.accessToken).toBeTypeOf("string");
    expect(res.body.data.tokens.refreshToken).toBeTypeOf("string");
    expect(res.text).not.toContain("passwordHash");
  });

  it("rejects a wrong password", async () => {
    const res = await loginUser({ password: "wrong-password1" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects an unknown email with the same error (no enumeration)", async () => {
    const res = await loginUser({ email: "nobody@example.com" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });
});

describe("GET /api/v1/auth/me", () => {
  it("rejects requests without a token", async () => {
    const res = await request(app).get("/api/v1/auth/me");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a malformed Authorization header", async () => {
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", "Token abc");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns the current user with a valid access token", async () => {
    const { body } = await registerUser();
    const { accessToken } = body.data.tokens;

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe("ada@example.com");
    expect(res.text).not.toContain("passwordHash");
  });

  it("rejects an expired access token", async () => {
    const { body } = await registerUser();
    const userId = body.data.user.id;

    const expiredToken = jwt.sign(
      { sub: userId, role: "user", type: "access" },
      env.JWT_ACCESS_SECRET,
      { expiresIn: -10, issuer: "searchforge-api" }
    );

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("ACCESS_TOKEN_EXPIRED");
  });

  it("rejects a refresh token used as an access token", async () => {
    const { body } = await registerUser();
    const { refreshToken } = body.data.tokens;

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${refreshToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_TOKEN");
  });
});

describe("POST /api/v1/auth/refresh", () => {
  it("rotates the refresh token and issues a new access token", async () => {
    const { body } = await registerUser();
    const { refreshToken } = body.data.tokens;

    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken });

    expect(res.status).toBe(200);
    const { tokens } = res.body.data;
    expect(tokens.accessToken).toBeTypeOf("string");
    expect(tokens.refreshToken).toBeTypeOf("string");
    expect(tokens.refreshToken).not.toBe(refreshToken);

    // The old token's stored hash is now revoked; only hashes are stored.
    const storedOld = await RefreshTokenModel.findOne({
      tokenHash: { $exists: true },
      revokedAt: { $exists: true },
    });
    expect(storedOld).not.toBeNull();
  });

  it("detects reuse of a rotated token and revokes the whole family", async () => {
    const { body } = await registerUser();
    const first = body.data.tokens.refreshToken;

    const rotated = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: first });
    expect(rotated.status).toBe(200);
    const second = rotated.body.data.tokens.refreshToken;

    // Attacker replays the already-rotated token
    const reused = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: first });
    expect(reused.status).toBe(401);
    expect(reused.body.error.code).toBe("REFRESH_TOKEN_REUSED");

    // The legitimate rotated token is dead too - entire family revoked
    const afterReuse = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: second });
    expect(afterReuse.status).toBe(401);
  });

  it("allows only one of two concurrent refreshes to succeed", async () => {
    const { body } = await registerUser();
    const { refreshToken } = body.data.tokens;

    const [a, b] = await Promise.all([
      request(app).post("/api/v1/auth/refresh").send({ refreshToken }),
      request(app).post("/api/v1/auth/refresh").send({ refreshToken }),
    ]);

    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses).toEqual([200, 401]);

    const loser = a.status === 401 ? a : b;
    expect(loser.body.error.code).toBe("REFRESH_TOKEN_REUSED");

    // The loser's reuse detection tombstones the family, so whatever the
    // winner was issued is already dead by the time both requests settle.
    const winner = a.status === 200 ? a : b;
    const winnerToken = winner.body.data.tokens.refreshToken as string;
    const afterFamilyKill = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: winnerToken });
    expect(afterFamilyKill.status).toBe(401);
  });

  it("rejects a token minted into a family after the family was revoked", async () => {
    // Simulate the rotation-vs-revocation race deterministically: a winning
    // rotation inserts its replacement document after the loser's family
    // sweep has already run.
    const { body } = await registerUser();
    const first = body.data.tokens.refreshToken as string;
    const { fam, sub } = jwt.decode(first) as { fam: string; sub: string };

    // Legitimate rotation, then replay of the rotated token -> family killed.
    await request(app).post("/api/v1/auth/refresh").send({ refreshToken: first });
    const reused = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: first });
    expect(reused.status).toBe(401);

    // A document inserted into the tombstoned family after the sweep - the
    // "winning" side of the race - must not remain usable.
    const straggler = signRefreshToken(sub, fam);
    await refreshTokenRepository.create({
      user: new mongoose.Types.ObjectId(sub),
      tokenHash: straggler.tokenHash,
      family: fam,
      expiresAt: straggler.expiresAt,
    });

    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: straggler.token });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("REFRESH_TOKEN_REUSED");
  });

  it("tombstones a family beyond every member token's expiry", async () => {
    const { body } = await registerUser();
    const first = body.data.tokens.refreshToken as string;
    const { fam } = jwt.decode(first) as { fam: string };

    await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: first });
    const reused = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: first });
    expect(reused.status).toBe(401);

    const tombstone = await RevokedTokenFamilyModel.findOne({ family: fam });
    expect(tombstone).not.toBeNull();

    const memberExpiries = (
      await RefreshTokenModel.find({ family: fam })
    ).map((doc) => doc.expiresAt.getTime());
    expect(memberExpiries.length).toBeGreaterThan(0);

    // Outlives every stored token in the family, and the rolling-expiry
    // straggler bound: detection time + a full refresh token lifetime.
    expect(tombstone!.expiresAt.getTime()).toBeGreaterThan(
      Math.max(...memberExpiries)
    );
    expect(tombstone!.expiresAt.getTime()).toBeGreaterThanOrEqual(
      Date.now() + ttlToSeconds(env.JWT_REFRESH_TOKEN_TTL) * 1000
    );
  });

  it("rejects a garbage token", async () => {
    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: "not-a-jwt" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_TOKEN");
  });
});

describe("POST /api/v1/auth/logout", () => {
  it("revokes the refresh token so it can no longer be used", async () => {
    const { body } = await registerUser();
    const { refreshToken } = body.data.tokens;

    const res = await request(app)
      .post("/api/v1/auth/logout")
      .send({ refreshToken });

    expect(res.status).toBe(200);

    const refreshAfter = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken });
    expect(refreshAfter.status).toBe(401);
  });

  it("is idempotent for unknown tokens", async () => {
    const res = await request(app)
      .post("/api/v1/auth/logout")
      .send({ refreshToken: "unknown-token-value" });

    expect(res.status).toBe(200);
  });
});

describe("suspended users", () => {
  it("cannot log in", async () => {
    await registerUser();
    await UserModel.updateOne(
      { email: VALID_USER.email },
      { status: "suspended" }
    );

    const res = await loginUser();

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ACCOUNT_SUSPENDED");
  });

  it("cannot use a previously issued access token", async () => {
    const { body } = await registerUser();
    const { accessToken } = body.data.tokens;

    await UserModel.updateOne(
      { email: VALID_USER.email },
      { status: "suspended" }
    );

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ACCOUNT_SUSPENDED");
  });

  it("cannot rotate refresh tokens", async () => {
    const { body } = await registerUser();
    const { refreshToken } = body.data.tokens;

    await UserModel.updateOne(
      { email: VALID_USER.email },
      { status: "suspended" }
    );

    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ACCOUNT_SUSPENDED");
  });
});
