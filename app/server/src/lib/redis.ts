import { createClient, type RedisClientType } from "redis";
import { config } from "../config.js";

let client: RedisClientType | null = null;

export async function getRedis(): Promise<RedisClientType> {
  if (client) return client;
  client = createClient({ url: config.redisUrl });
  client.on("error", (err) => console.error("[redis] error", err));
  await client.connect();
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
