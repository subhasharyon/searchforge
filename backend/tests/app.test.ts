import { describe, expect, it } from "vitest";
import express from "express";
import rateLimit from "express-rate-limit";
import request from "supertest";
import app, { parseTrustProxy } from "../src/app.js";
import { AppError } from "../src/shared/errors/app-error.js";
import { errorHandler } from "../src/shared/middleware/error.middleware.js";

describe("app", () => {
  it("GET / returns the welcome payload", async () => {
    const res = await request(app).get("/");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      message: "Welcome to SearchForge API",
    });
  });

  it("returns a structured 404 for unknown routes", async () => {
    const res = await request(app).get("/api/v1/does-not-exist");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: "NOT_FOUND" },
    });
  });

  it("sets security headers via helmet", async () => {
    const res = await request(app).get("/");

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBeDefined();
  });
});

describe("trust proxy", () => {
  it("does not trust any proxy in the default (direct) topology", () => {
    // TRUST_PROXY is unset in the test env -> direct clients only.
    expect(app.get("trust proxy")).toBe(false);
  });

  it("maps TRUST_PROXY values to the Express setting safely", () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy("")).toBe(false);
    expect(parseTrustProxy("false")).toBe(false);
    expect(parseTrustProxy("1")).toBe(1);
    expect(parseTrustProxy("loopback")).toEqual(["loopback"]);
    expect(parseTrustProxy("10.0.0.0/8, 172.16.0.0/12")).toEqual([
      "10.0.0.0/8",
      "172.16.0.0/12",
    ]);
  });

  it("cannot have rate limiting bypassed by spoofing X-Forwarded-For", async () => {
    // Probe app uses the SAME trust proxy setting as the real app.
    const probe = express();
    probe.set("trust proxy", app.get("trust proxy"));

    probe.get("/ip", (req, res) => {
      res.json({ ip: req.ip });
    });

    probe.use(
      rateLimit({
        windowMs: 60_000,
        limit: 2,
        handler: (_req, _res, next) =>
          next(new AppError("limited", 429, "RATE_LIMITED")),
      })
    );
    probe.get("/probe", (_req, res) => {
      res.json({ ok: true });
    });
    probe.use(errorHandler);

    // req.ip ignores the spoofed header entirely.
    const ipRes = await request(probe)
      .get("/ip")
      .set("X-Forwarded-For", "203.0.113.99");
    expect(ipRes.body.ip).not.toBe("203.0.113.99");

    // Three requests each claiming a different client IP all land in the
    // same bucket: the third is rate limited.
    const first = await request(probe)
      .get("/probe")
      .set("X-Forwarded-For", "198.51.100.1");
    const second = await request(probe)
      .get("/probe")
      .set("X-Forwarded-For", "198.51.100.2");
    const third = await request(probe)
      .get("/probe")
      .set("X-Forwarded-For", "198.51.100.3");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
  });
});
