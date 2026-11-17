import { Client, type ClientOptions } from "@elastic/elasticsearch";
import { env } from "./env.js";
import { logger } from "./logger.js";

// Auth precedence: dedicated API key > dedicated app user.
// The `elastic` superuser is only tolerated as a development fallback until
// `npm run setup:es` has been run; in production it is rejected outright.
const buildAuth = (): ClientOptions["auth"] => {
  if (env.ELASTICSEARCH_API_KEY) {
    return { apiKey: env.ELASTICSEARCH_API_KEY };
  }

  if (env.ELASTICSEARCH_APP_PASSWORD) {
    return {
      username: env.ELASTICSEARCH_USERNAME,
      password: env.ELASTICSEARCH_APP_PASSWORD,
    };
  }

  if (env.NODE_ENV !== "production" && env.ELASTIC_PASSWORD) {
    logger.warn(
      "Using the `elastic` superuser for application access. Run " +
        "`npm run setup:es` and set ELASTICSEARCH_API_KEY before deploying."
    );
    return { username: "elastic", password: env.ELASTIC_PASSWORD };
  }

  throw new Error(
    "No Elasticsearch credentials configured. Set ELASTICSEARCH_API_KEY " +
      "or ELASTICSEARCH_APP_PASSWORD (run `npm run setup:es` to create them)."
  );
};

export const elasticsearchClient = new Client({
  node: env.ELASTICSEARCH_URL,
  auth: buildAuth(),
});

export const connectElasticsearch = async (): Promise<void> => {
  try {
    const response = await elasticsearchClient.info();

    logger.info(
      `Elasticsearch connected successfully: version ${response.version.number}`
    );
  } catch (error) {
    logger.error({ err: error }, "Elasticsearch connection failed");
    throw error;
  }
};
