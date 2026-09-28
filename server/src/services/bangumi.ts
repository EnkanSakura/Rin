import type { UserSubjectCollection, UserSubjectCollectionResponse } from "@rin/api";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppContext, CacheImpl, DB } from "../core/hono-types";
import { profileAsync } from "../core/server-timing";
import { bangumiCache } from "../db/schema";
import { createOutboundFetch } from "../utils/outbound";

const DEFAULT_API_URL = "https://api.bgm.tv";
const DEFAULT_USER_AGENT = "Rin-Bangumi/1.0";
const PAGE_SIZE = 100;
/**
 * Cover images are proxied through the Worker (see GET /bangumi/cover) so the
 * browser never has to reach `*.bgm.tv` itself; only those hosts may be fetched
 * to keep the endpoint from becoming an open proxy.
 */
const COVER_HOST_SUFFIXES = ["bgm.tv", "bangumi.tv"];
const COVER_USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
/** Cover files are small; anything beyond this is treated as a bad upstream. */
const MAX_COVER_BYTES = 8 * 1024 * 1024;
/**
 * Bangumi cover URLs are content-addressed (`.../pic/cover/l/ab/cd/<id>.jpg`),
 * so a changed cover gets a new URL. Both the browser and the edge cache can
 * therefore keep a cover for a year (1 year is also Cloudflare's cache ceiling).
 */
const COVER_CACHE_SECONDS = 365 * 24 * 60 * 60;
/**
 * Snapshot freshness window used by the scheduled task. The cron trigger fires
 * hourly (plus a dedicated daily trigger); syncing only when the snapshot is
 * older than 23 hours keeps the refresh rate at ~once per day.
 */
const SNAPSHOT_MAX_AGE_SECONDS = 23 * 60 * 60;
/**
 * Manual refresh (POST /update) throttle: repeated requests within this window
 * return the stored snapshot without calling the Bangumi API again.
 */
const MANUAL_REFRESH_MIN_INTERVAL_SECONDS = 60;

export interface BangumiSnapshot {
    data: UserSubjectCollection[];
    updatedAt: Date;
}

export interface BangumiPublicResponse {
    mode: "realtime" | "auto";
    total: number;
    data: UserSubjectCollection[];
    /** Unix epoch seconds of the snapshot; null when served live. */
    updatedAt: number | null;
}

/** Response of the manual update endpoint; updated=false means a fresh snapshot was returned. */
export interface BangumiUpdateResponse extends BangumiPublicResponse {
    updated: boolean;
}

interface BangumiSettings {
    userId: string;
    apiUrl: string;
    userAgent: string;
    updateMode: string;
}

// ============================================================================
// Bangumi API client (server side)
// ============================================================================

export async function fetchBangumiCollectionPage(
    userId: string,
    apiUrl: string,
    userAgent: string,
    limit = PAGE_SIZE,
    offset = 0,
    fetchImpl: typeof fetch = fetch,
): Promise<UserSubjectCollectionResponse> {
    const url = `${apiUrl}/v0/users/${encodeURIComponent(userId)}/collections?limit=${limit}&offset=${offset}`;
    const res = await fetchImpl(url, {
        headers: {
            Accept: "application/json",
            "User-Agent": userAgent,
        },
    });
    if (!res.ok) {
        throw new Error(`Bangumi API error: ${res.status}`);
    }
    return res.json() as Promise<UserSubjectCollectionResponse>;
}

/** Fetch the full collection with pagination (mirrors the client-side loader). */
export async function fetchAllBangumiCollections(
    userId: string,
    apiUrl: string,
    userAgent: string,
    maxLimit = PAGE_SIZE,
    fetchImpl: typeof fetch = fetch,
): Promise<UserSubjectCollection[]> {
    const all: UserSubjectCollection[] = [];
    let offset = 0;
    let total = 0;

    do {
        const res = await fetchBangumiCollectionPage(
            userId,
            apiUrl,
            userAgent,
            maxLimit,
            offset,
            fetchImpl,
        );
        all.push(...res.data);
        total = res.total;
        offset += maxLimit;
    } while (offset < total);

    return all;
}

// ============================================================================
// D1 snapshot storage
// ============================================================================

export async function readBangumiSnapshot(db: DB, userId: string): Promise<BangumiSnapshot | null> {
    const rows = await db.select().from(bangumiCache).where(eq(bangumiCache.userId, userId)).limit(1);
    const row = rows[0];
    if (!row) {
        return null;
    }
    try {
        const parsed: unknown = JSON.parse(row.data);
        if (!Array.isArray(parsed)) {
            return null;
        }
        return { data: parsed as UserSubjectCollection[], updatedAt: row.updatedAt };
    } catch {
        return null;
    }
}

export async function storeBangumiSnapshot(
    db: DB,
    userId: string,
    data: UserSubjectCollection[],
): Promise<void> {
    const now = new Date();
    const payload = JSON.stringify(data);
    await db
        .insert(bangumiCache)
        .values({ userId, data: payload, total: data.length, updatedAt: now })
        .onConflictDoUpdate({
            target: bangumiCache.userId,
            set: { data: payload, total: data.length, updatedAt: now },
        });
}

// ============================================================================
// Settings resolution
// ============================================================================

async function resolveBangumiSettings(clientConfig: CacheImpl): Promise<BangumiSettings> {
    // 追番默认启用（不再提供“启用追番”开关），仅需配置用户 ID。
    const [rawUserId, apiUrl, userAgent, updateMode] = await Promise.all([
        clientConfig.getOrDefault<unknown>("bangumi.userId", ""),
        clientConfig.getOrDefault<string>("bangumi.apiUrl", DEFAULT_API_URL),
        clientConfig.getOrDefault<string>("bangumi.userAgent", DEFAULT_USER_AGENT),
        clientConfig.getOrDefault<string>("bangumi.updateMode", "realtime"),
    ]);
    return {
        userId: String(rawUserId ?? "").trim(),
        apiUrl: String(apiUrl ?? DEFAULT_API_URL).trim() || DEFAULT_API_URL,
        userAgent: String(userAgent ?? DEFAULT_USER_AGENT).trim() || DEFAULT_USER_AGENT,
        updateMode: String(updateMode ?? "realtime"),
    };
}

// ============================================================================
// Cover proxy
// ============================================================================

function isAllowedCoverHost(hostname: string): boolean {
    const host = hostname.toLowerCase();
    return COVER_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/**
 * Validate a Bangumi cover URL coming from the client. Only http(s) URLs on
 * Bangumi hosts are accepted; everything else (including internal addresses)
 * is rejected so the cover route cannot be used as an open proxy.
 */
export function normalizeCoverUrl(raw: string | null | undefined): string | null {
    const value = (raw ?? "").trim();
    if (!value) {
        return null;
    }
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return null;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        return null;
    }
    if (!isAllowedCoverHost(url.hostname)) {
        return null;
    }
    return url.toString();
}

/** The slice of the Cloudflare Cache API this route needs. */
interface EdgeCache {
    match(request: Request): Promise<Response | undefined>;
    put(request: Request, response: Response): Promise<void>;
}

/**
 * Cloudflare edge cache, or null when the runtime has no Cache API (tests,
 * Bun). Read through `globalThis` so the route stays independent of which
 * `caches` declaration the active tsconfig picks up.
 */
function edgeCache(): EdgeCache | null {
    const globalCaches = (globalThis as { caches?: { default?: EdgeCache } }).caches;
    return globalCaches?.default ?? null;
}

/** Run a cache write without blocking the response when waitUntil is available. */
function runInBackground(c: AppContext, task: Promise<unknown>): void {
    const guarded = task.catch((error) => {
        console.error(`[Bangumi] background task failed: ${String(error)}`);
    });
    try {
        c.executionCtx.waitUntil(guarded);
    } catch {
        // No execution context (tests): the cache is disabled there anyway.
        void guarded;
    }
}

// ============================================================================
// Route: GET /api/bangumi
// ============================================================================

export function BangumiService(): Hono {
    const app = new Hono();

    app.get("/", async (c: AppContext) => {
        const db = c.get("db");
        const clientConfig = c.get("clientConfig");

        const settings = await profileAsync(c, "bangumi_settings", () => resolveBangumiSettings(clientConfig));
        if (!settings.userId) {
            c.status(404);
            return c.text("Bangumi not configured");
        }

        // "auto": serve the daily-synced D1 snapshot. When the snapshot is
        // missing (first use after switching to auto), hydrate it on the fly.
        if (settings.updateMode === "auto") {
            const snapshot = await profileAsync(c, "bangumi_snapshot_read", () =>
                readBangumiSnapshot(db, settings.userId),
            );
            if (snapshot) {
                const body: BangumiPublicResponse = {
                    mode: "auto",
                    total: snapshot.data.length,
                    data: snapshot.data,
                    updatedAt: Math.floor(snapshot.updatedAt.getTime() / 1000),
                };
                return c.json(body);
            }

            try {
                const items = await profileAsync(c, "bangumi_live_fetch", () =>
                    fetchAllBangumiCollections(
                        settings.userId,
                        settings.apiUrl,
                        settings.userAgent,
                        PAGE_SIZE,
                        createOutboundFetch(c.get("env")),
                    ),
                );
                await profileAsync(c, "bangumi_snapshot_store", () =>
                    storeBangumiSnapshot(db, settings.userId, items),
                );
                const body: BangumiPublicResponse = {
                    mode: "auto",
                    total: items.length,
                    data: items,
                    updatedAt: Math.floor(Date.now() / 1000),
                };
                return c.json(body);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                c.status(502);
                return c.text(message);
            }
        }

        // "realtime": fetch from the Bangumi API on every request. The page
        // normally talks to bgm.tv directly in this mode; this endpoint keeps
        // the same behavior available through the site API.
        try {
            const items = await profileAsync(c, "bangumi_live_fetch", () =>
                fetchAllBangumiCollections(
                    settings.userId,
                    settings.apiUrl,
                    settings.userAgent,
                    PAGE_SIZE,
                    createOutboundFetch(c.get("env")),
                ),
            );
            const body: BangumiPublicResponse = {
                mode: "realtime",
                total: items.length,
                data: items,
                updatedAt: null,
            };
            return c.json(body);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            c.status(502);
            return c.text(message);
        }
    });

    // GET /bangumi/cover?src=<bangumi image url>
    // Serves a Bangumi cover through the Worker so the browser only talks to
    // this site. The response is stored in the Cloudflare edge cache, so a
    // visitor whose network cannot reach bgm.tv still gets the artwork.
    app.get("/cover", async (c: AppContext) => {
        const target = normalizeCoverUrl(c.req.query("src"));
        if (!target) {
            c.status(400);
            return c.text("invalid cover url");
        }

        const cache = edgeCache();
        const cacheKey = new Request(c.req.url, { method: "GET" });
        if (cache) {
            const hit = await cache.match(cacheKey);
            if (hit) {
                return hit;
            }
        }

        try {
            const upstream = await createOutboundFetch(c.get("env"))(target, {
                headers: {
                    "user-agent": COVER_USER_AGENT,
                    accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                    referer: "https://bgm.tv/",
                },
            });
            if (!upstream.ok) {
                c.status(502);
                return c.text(`cover upstream ${upstream.status}`);
            }

            const length = Number(upstream.headers.get("content-length") ?? 0);
            if (Number.isFinite(length) && length > MAX_COVER_BYTES) {
                c.status(413);
                return c.text("cover is too large");
            }

            // Reject error documents served with a 200 so the client can fall
            // back to its placeholder instead of rendering a broken image.
            const contentType = upstream.headers.get("content-type") ?? "";
            if (contentType && !/^(image\/|application\/octet-stream)/i.test(contentType)) {
                c.status(502);
                return c.text(`cover upstream content-type ${contentType}`);
            }

            const body = await upstream.arrayBuffer();
            if (body.byteLength > MAX_COVER_BYTES) {
                c.status(413);
                return c.text("cover is too large");
            }

            const headers = new Headers({
                "content-type": contentType || "image/jpeg",
                "cache-control": `public, max-age=${COVER_CACHE_SECONDS}, immutable`,
                "access-control-allow-origin": "*",
            });
            const response = new Response(body, { status: 200, headers });
            if (cache) {
                runInBackground(c, cache.put(cacheKey, response.clone()));
            }
            return response;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            c.status(502);
            return c.text(message);
        }
    });

    // POST /bangumi/update - Manual sync (auto mode only, throttled). Pulls the
    // latest collection from the Bangumi API, stores it in D1 and returns the
    // fresh snapshot; repeated requests within a short window are served from
    // the stored snapshot without hitting the upstream API again.
    app.post("/update", async (c: AppContext) => {
        const db = c.get("db");
        const clientConfig = c.get("clientConfig");

        const settings = await profileAsync(c, "bangumi_settings", () => resolveBangumiSettings(clientConfig));
        if (!settings.userId) {
            c.status(404);
            return c.text("Bangumi not configured");
        }
        if (settings.updateMode !== "auto") {
            c.status(400);
            return c.text("Manual update is only available in auto mode");
        }

        const snapshot = await profileAsync(c, "bangumi_snapshot_read", () =>
            readBangumiSnapshot(db, settings.userId),
        );
        const nowSeconds = Math.floor(Date.now() / 1000);
        if (
            snapshot &&
            nowSeconds - Math.floor(snapshot.updatedAt.getTime() / 1000) <
                MANUAL_REFRESH_MIN_INTERVAL_SECONDS
        ) {
            const body: BangumiUpdateResponse = {
                mode: "auto",
                total: snapshot.data.length,
                data: snapshot.data,
                updatedAt: Math.floor(snapshot.updatedAt.getTime() / 1000),
                updated: false,
            };
            return c.json(body);
        }

        try {
            const items = await profileAsync(c, "bangumi_live_fetch", () =>
                fetchAllBangumiCollections(
                    settings.userId,
                    settings.apiUrl,
                    settings.userAgent,
                    PAGE_SIZE,
                    createOutboundFetch(c.get("env")),
                ),
            );
            await profileAsync(c, "bangumi_snapshot_store", () =>
                storeBangumiSnapshot(db, settings.userId, items),
            );
            const body: BangumiUpdateResponse = {
                mode: "auto",
                total: items.length,
                data: items,
                updatedAt: Math.floor(Date.now() / 1000),
                updated: true,
            };
            return c.json(body);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            c.status(502);
            return c.text(message);
        }
    });

    return app;
}

// ============================================================================
// Scheduled task: daily snapshot sync (only meaningful in "auto" mode)
// ============================================================================

export async function bangumiCrontab(
    db: DB,
    clientConfig: CacheImpl,
    fetchImpl: typeof fetch = fetch,
) {
    const settings = await resolveBangumiSettings(clientConfig);

    if (settings.updateMode !== "auto") {
        console.info("[Bangumi] crontab skipped: update mode is not auto");
        return;
    }
    if (!settings.userId) {
        console.info("[Bangumi] crontab skipped: no Bangumi user id configured");
        return;
    }

    const snapshot = await readBangumiSnapshot(db, settings.userId);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (
        snapshot &&
        nowSeconds - Math.floor(snapshot.updatedAt.getTime() / 1000) < SNAPSHOT_MAX_AGE_SECONDS
    ) {
        console.info("[Bangumi] crontab skipped: snapshot is still fresh");
        return;
    }

    try {
        const items = await fetchAllBangumiCollections(
            settings.userId,
            settings.apiUrl,
            settings.userAgent,
            PAGE_SIZE,
            fetchImpl,
        );
        await storeBangumiSnapshot(db, settings.userId, items);
        console.info(`[Bangumi] synced ${items.length} collections for user ${settings.userId}`);
    } catch (error) {
        // Keep the previous snapshot intact when the sync fails.
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[Bangumi] sync failed: ${message}`);
    }
}
