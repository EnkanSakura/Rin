import { drizzle } from "drizzle-orm/d1";
import { CacheImpl } from "../utils/cache";
import { KVConfigImpl } from "../utils/kv-config";

export async function handleScheduled(
  _controller: ScheduledController | null,
  env: Env,
  ctx: ExecutionContext,
) {
  const schema = await import("../db/schema");
  const db = drizzle(env.DB, { schema });

  const serverConfig = new KVConfigImpl(env.CONFIG_KV, "server.config");
  const clientConfig = new KVConfigImpl(env.CONFIG_KV, "client.config");
  const cache = new CacheImpl(db, env, "cache", undefined, clientConfig);

  const { friendCrontab } = await import("../services/friends");
  const { rssCrontab } = await import("../services/rss");
  const { sitemapCrontab } = await import("../services/sitemap");
  const { bangumiCrontab } = await import("../services/bangumi");

  await friendCrontab(env, ctx, db, cache, serverConfig, clientConfig);
  await rssCrontab(env, db);
  await sitemapCrontab(env, db);
  await bangumiCrontab(db, clientConfig);
}
