import type {
  EvaluationDataset,
} from "../types/evaluation.types.js";

/**
 * Curated evaluation dataset. Judgments reference canonical document
 * identities (source + url) from the seeded evaluation corpus - the
 * runner resolves them to live MongoDB documents and reports any it
 * cannot find, so no document id is ever fabricated.
 *
 * Grades: 3 = highly relevant, 2 = relevant, 1 = marginal, 0 = not.
 */
export const EVALUATION_DATASET: EvaluationDataset = {
  version: "1.0.0",
  description:
    "20 technical queries judged against the seeded evaluation corpus (eval-corpus.ts)",
  queries: [
    {
      id: "nodejs-streams",
      text: "nodejs streams",
      judgments: [
        { source: "nodejs", url: "https://nodejs.org/api/stream.html", grade: 3 },
        { source: "nodejs", url: "https://nodejs.org/api/buffer.html", grade: 1 },
        { source: "nodejs", url: "https://nodejs.org/api/fs.html", grade: 1 },
      ],
    },
    {
      id: "nodejs-events",
      text: "event emitter",
      judgments: [
        { source: "nodejs", url: "https://nodejs.org/api/events.html", grade: 3 },
      ],
    },
    {
      id: "nodejs-read-file",
      text: "read file asynchronously",
      judgments: [
        { source: "nodejs", url: "https://nodejs.org/api/fs.html", grade: 3 },
        { source: "nodejs", url: "https://nodejs.org/api/stream.html", grade: 1 },
      ],
    },
    {
      id: "nodejs-buffer",
      text: "binary data buffer",
      judgments: [
        { source: "nodejs", url: "https://nodejs.org/api/buffer.html", grade: 3 },
      ],
    },
    {
      id: "js-promises",
      text: "javascript promise async",
      judgments: [
        {
          source: "mdn",
          url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise",
          grade: 3,
        },
      ],
    },
    {
      id: "js-array-methods",
      text: "array map filter reduce",
      judgments: [
        {
          source: "mdn",
          url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array",
          grade: 3,
        },
      ],
    },
    {
      id: "js-closures",
      text: "closures lexical scope",
      judgments: [
        {
          source: "mdn",
          url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Closures",
          grade: 3,
        },
      ],
    },
    {
      id: "ts-generics",
      text: "typescript generics",
      judgments: [
        {
          source: "typescript",
          url: "https://www.typescriptlang.org/docs/handbook/2/generics.html",
          grade: 3,
        },
      ],
    },
    {
      id: "ts-narrowing",
      text: "typescript type narrowing",
      judgments: [
        {
          source: "typescript",
          url: "https://www.typescriptlang.org/docs/handbook/2/narrowing.html",
          grade: 3,
        },
        {
          source: "typescript",
          url: "https://www.typescriptlang.org/docs/handbook/2/generics.html",
          grade: 1,
        },
      ],
    },
    {
      id: "mongo-indexes",
      text: "mongodb index performance",
      judgments: [
        {
          source: "mongodb",
          url: "https://www.mongodb.com/docs/manual/indexes/",
          grade: 3,
        },
      ],
    },
    {
      id: "mongo-aggregation",
      text: "mongodb aggregation pipeline",
      judgments: [
        {
          source: "mongodb",
          url: "https://www.mongodb.com/docs/manual/aggregation/",
          grade: 3,
        },
      ],
    },
    {
      id: "redis-data-types",
      text: "redis data structures",
      judgments: [
        {
          source: "redis",
          url: "https://redis.io/docs/latest/develop/data-types/",
          grade: 3,
        },
      ],
    },
    {
      id: "redis-cache",
      text: "redis cache expiration",
      judgments: [
        {
          source: "redis",
          url: "https://redis.io/docs/latest/develop/data-types/",
          grade: 3,
        },
      ],
    },
    {
      id: "es-bm25",
      text: "bm25 relevance scoring",
      judgments: [
        {
          source: "elastic",
          url: "https://www.elastic.co/guide/en/elasticsearch/reference/current/index-modules-similarity.html",
          grade: 3,
        },
        {
          source: "elastic",
          url: "https://www.elastic.co/guide/en/elasticsearch/reference/current/mapping.html",
          grade: 1,
        },
      ],
    },
    {
      id: "es-mapping",
      text: "elasticsearch field mapping",
      judgments: [
        {
          source: "elastic",
          url: "https://www.elastic.co/guide/en/elasticsearch/reference/current/mapping.html",
          grade: 3,
        },
      ],
    },
    {
      id: "docker-overview",
      text: "docker container image",
      judgments: [
        {
          source: "docker",
          url: "https://docs.docker.com/get-started/docker-overview/",
          grade: 3,
        },
      ],
    },
    {
      id: "docker-network",
      text: "docker network containers",
      judgments: [
        {
          source: "docker",
          url: "https://docs.docker.com/engine/network/",
          grade: 3,
        },
        {
          source: "docker",
          url: "https://docs.docker.com/get-started/docker-overview/",
          grade: 1,
        },
      ],
    },
    {
      id: "react-hooks",
      text: "react hooks usestate useeffect",
      judgments: [
        {
          source: "react",
          url: "https://react.dev/reference/react/hooks",
          grade: 3,
        },
      ],
    },
    {
      id: "rest-api-design",
      text: "rest api design",
      judgments: [
        {
          source: "microsoft",
          url: "https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design",
          grade: 3,
        },
      ],
    },
    {
      id: "jwt-auth",
      text: "jwt authentication token",
      judgments: [
        { source: "jwt", url: "https://jwt.io/introduction", grade: 3 },
        {
          source: "microsoft",
          url: "https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design",
          grade: 1,
        },
      ],
    },
  ],
};
