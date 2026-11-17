import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app.js";

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
