import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Resolve the repo-root .env relative to this file so it works regardless of
// the process cwd and from both src/ (tsx) and dist/ (compiled output).
const configDir = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({
  path: process.env.DOTENV_CONFIG_PATH ?? path.resolve(configDir, "../../../.env"),
  quiet: true,
});

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  PORT: z.coerce.number().default(5000),

  CORS_ORIGIN: z.string().default("http://localhost:3000"),

  MONGODB_URI: z.string().min(1),

  ELASTICSEARCH_URL: z.url(),

  // Preferred application credentials. At least one of these must be set at
  // connect time; enforced in config/elasticsearch.ts.
  ELASTICSEARCH_API_KEY: z.string().optional(),
  ELASTICSEARCH_USERNAME: z.string().default("searchforge_app"),
  ELASTICSEARCH_APP_PASSWORD: z.string().optional(),

  // Built-in superuser password. Only needed for `npm run setup:es`
  // (bootstrap) and local docker-compose, not for API runtime auth.
  ELASTIC_PASSWORD: z.string().optional(),

  KIBANA_SYSTEM_PASSWORD: z.string().optional(),

  REDIS_URL: z.url(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  // Express "trust proxy" topology. Empty/false: no proxy, X-Forwarded-For
  // ignored (local dev / direct connections). "N": trust the N closest hops.
  // IPs/subnets/predefined names ("loopback", "linklocal", "uniquelocal"),
  // comma-separated: trust only those proxy addresses. "true" is forbidden.
  TRUST_PROXY: z
    .string()
    .optional()
    .refine(
      (value) => value?.trim().toLowerCase() !== "true",
      "TRUST_PROXY=true trusts arbitrary X-Forwarded-For and defeats rate limiting"
    ),

  // Semantic-search embedding provider (M7.1).
  // "disabled": no vector work anywhere; keyword search is unaffected and
  // mode=semantic returns 503. "local": deterministic feature-hashing
  // vectors for development/testing - NO real semantics. "openai-compat":
  // any OpenAI-compatible POST {api}/embeddings endpoint (OpenAI, Voyage,
  // self-hosted). When enabled, all of the provider settings are required
  // except for "local", which needs only EMBEDDING_DIMS.
  EMBEDDING_PROVIDER: z
    .enum(["disabled", "local", "openai-compat"])
    .default("disabled"),
  EMBEDDING_API_URL: z.url().optional(),
  EMBEDDING_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().optional(),
  EMBEDDING_DIMS: z.coerce.number().int().positive().optional(),
  EMBEDDING_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  // Max credential-endpoint requests per IP per 15 minutes (brute-force
  // protection). Raised in the test env so suites aren't self-limiting.
  AUTH_CREDENTIAL_RATE_LIMIT: z.coerce.number().int().positive().default(20),

  // ms-style durations with an explicit unit, e.g. "15m", "7d".
  JWT_ACCESS_TOKEN_TTL: z
    .string()
    .regex(/^\d+[smhdw]$/, "Expected e.g. '15m', '1h', '7d'")
    .default("15m"),
  JWT_REFRESH_TOKEN_TTL: z
    .string()
    .regex(/^\d+[smhdw]$/, "Expected e.g. '15m', '1h', '7d'")
    .default("7d"),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error("Invalid environment configuration:");
  console.error(parsedEnv.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsedEnv.data;
