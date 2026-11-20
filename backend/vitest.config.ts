import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // mongodb-memory-server downloads a mongod binary on first run
    hookTimeout: 120_000,
    testTimeout: 30_000,
    env: {
      NODE_ENV: "test",
      JWT_ACCESS_SECRET:
        "test-access-secret-0123456789abcdef0123456789abcdef",
      JWT_REFRESH_SECRET:
        "test-refresh-secret-0123456789abcdef0123456789abcdef",
      JWT_ACCESS_TOKEN_TTL: "15m",
      JWT_REFRESH_TOKEN_TTL: "7d",
      // Suite makes more credential requests than the production limit allows
      AUTH_CREDENTIAL_RATE_LIMIT: "1000",
      // Never let a local .env leak a real embedding provider into tests -
      // suites that need one inject embeddingDeps.provider explicitly.
      EMBEDDING_PROVIDER: "disabled",
    },
  },
});
