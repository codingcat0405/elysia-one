import { Redis } from "ioredis";
import logger from "./logger";

let redisClient: Redis | null = null;

export async function getRedis(): Promise<Redis> {
  if (redisClient) {
    return redisClient;
  }
  redisClient = new Redis(process.env.REDIS_URL!, {
    // exponential-ish backoff capped at 5s; must always return a number —
    // returning null/undefined would stop reconnecting permanently.
    retryStrategy: (times) => Math.min(times * 200, 5000),
    // fail a command after 3 in-flight retries instead of hanging a request
    // for minutes during an outage (default 20 hangs too long, null forever).
    maxRetriesPerRequest: 3,
    // detect dead sockets behind NAT/LB idle timeouts (default is effectively off)
    keepAlive: 30_000,
    connectTimeout: 10_000,
  });

  // attach BEFORE any command: an unhandled 'error' event crashes the process
  redisClient.on("error", (err) => logger.error("Redis error", err));
  redisClient.on("ready", () => logger.info("Redis connected"));
  redisClient.on("reconnecting", (delay: number) =>
    logger.warn("Redis reconnecting", { delay }),
  );

  return redisClient;
}
