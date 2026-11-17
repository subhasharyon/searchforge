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
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error("Invalid environment configuration:");
  console.error(parsedEnv.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsedEnv.data;
