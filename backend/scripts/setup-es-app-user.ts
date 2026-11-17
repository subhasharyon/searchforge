/**
 * One-time Elasticsearch security bootstrap.
 *
 * Run once after `docker compose up -d` (from the backend directory):
 *
 *   npm run setup:es
 *
 * Uses the `elastic` superuser (ELASTIC_PASSWORD) to:
 *   1. Create the `searchforge_app` role scoped to `searchforge-*` indices.
 *   2. Create the `searchforge_app` user with a generated password.
 *   3. Create an API key for that user and print it - put it in the repo-root
 *      .env as ELASTICSEARCH_API_KEY.
 *   4. Set the `kibana_system` password to KIBANA_SYSTEM_PASSWORD so Kibana
 *      can authenticate.
 *
 * Safe to re-run: the role and user are overwritten, a fresh API key is issued.
 */
import { Client } from "@elastic/elasticsearch";
import { randomBytes } from "node:crypto";
import { env } from "../src/config/env.js";

const APP_USER = "searchforge_app";
const APP_ROLE = "searchforge_app";
const INDEX_PATTERN = "searchforge-*";

const main = async (): Promise<void> => {
  if (!env.ELASTIC_PASSWORD) {
    console.error("ELASTIC_PASSWORD is required to run this script.");
    process.exit(1);
  }

  const client = new Client({
    node: env.ELASTICSEARCH_URL,
    auth: { username: "elastic", password: env.ELASTIC_PASSWORD },
  });

  await client.info();

  const appPassword = randomBytes(24).toString("base64url");

  await client.security.putRole({
    name: APP_ROLE,
    cluster: ["monitor"],
    indices: [
      {
        names: [INDEX_PATTERN],
        privileges: ["all"],
        allow_restricted_indices: false,
      },
    ],
  });
  console.log(`Role '${APP_ROLE}' upserted (indices: ${INDEX_PATTERN}).`);

  await client.security.putUser({
    username: APP_USER,
    password: appPassword,
    roles: [APP_ROLE],
    enabled: true,
  });
  console.log(`User '${APP_USER}' upserted.`);

  const apiKey = await client.security.createApiKey({
    name: `${APP_USER}-key`,
    expiration: "365d",
    role_descriptors: {
      [APP_ROLE]: {
        cluster: ["monitor"],
        indices: [
          {
            names: [INDEX_PATTERN],
            privileges: ["all"],
            allow_restricted_indices: false,
          },
        ],
      },
    },
  });

  if (env.KIBANA_SYSTEM_PASSWORD) {
    await client.security.changePassword({
      username: "kibana_system",
      password: env.KIBANA_SYSTEM_PASSWORD,
    });
    console.log("kibana_system password set.");
  }

  console.log("\nAdd the following to the repo-root .env:\n");
  console.log(`ELASTICSEARCH_API_KEY=${apiKey.encoded}`);
  console.log(`ELASTICSEARCH_USERNAME=${APP_USER}`);
  console.log(`ELASTICSEARCH_APP_PASSWORD=${appPassword}`);
  console.log(
    "\nThe API key is preferred; the user/password pair is a fallback."
  );
};

main().catch((error: unknown) => {
  console.error("Elasticsearch setup failed:", error);
  process.exit(1);
});
