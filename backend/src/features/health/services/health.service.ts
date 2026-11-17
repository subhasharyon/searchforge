
import mongoose from "mongoose";
import { elasticsearchClient } from "../../../config/elasticsearch.js";
import { redisClient } from "../../../config/redis.js";

export const getHealthStatus = async () => {
  const [mongoResult, elasticResult, redisResult] =
    await Promise.allSettled([
      mongoose.connection.db?.admin().ping(),
      elasticsearchClient.cluster.health(),
      redisClient.ping(),
    ]);

  const dependencies = {
    mongodb: mongoResult.status === "fulfilled" ? "healthy" : "unhealthy",
    elasticsearch:
      elasticResult.status === "fulfilled" ? "healthy" : "unhealthy",
    redis: redisResult.status === "fulfilled" ? "healthy" : "unhealthy",
  };

  const allHealthy = Object.values(dependencies).every(
    (status) => status === "healthy"
  );

  return {
    status: allHealthy ? "healthy" : "degraded",
    service: "SearchForge API",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    dependencies,
  };
};
