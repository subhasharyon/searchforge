/**
 * Shared Redis connection for server-side state (session store).
 * Returns null when REDIS_URL is unset — callers fall back to
 * process-local storage, which is the documented dev behavior.
 *
 * Server-only: never import from client components and never use a
 * NEXT_PUBLIC_ env var.
 */

import Redis from "ioredis";

let client: Redis | null = null;

export function getRedis(): Redis | null {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  client ??= new Redis(url, {
    maxRetriesPerRequest: 3,
    // A stalled Redis must not hang request handling indefinitely.
    commandTimeout: 3_000,
    lazyConnect: true,
  });
  return client;
}
