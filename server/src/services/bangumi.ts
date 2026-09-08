import type { UserSubjectCollection, UserSubjectCollectionResponse } from "@rin/api";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppContext, CacheImpl, DB } from "../core/hono-types";
import { profileAsync } from "../core/server-timing";
import { bangumiCache } from "../db/schema";

const DEFAULT_API_URL = "https://api.bgm.tv";
const DEFAULT_USER_AGENT = "Rin-Bangumi/1.0";
const PAGE_SIZE = 100;
/**
 * Snapshot freshness window used by the scheduled task. The cron trigger fires
 * every 20 minutes (plus a dedicated daily trigger); syncing only when the
 * snapshot is older than 23 hours keeps the refresh rate at ~once per day.
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
): Promise<UserSubjectCollectionResponse> {
    const url = `${apiUrl}/v0/users/${encodeURIComponent(userId)}/collections?limit=${limit}&offset=${offset}`;
    const res = await fetch(url, {
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
): Promise<UserSubjectCollection[]> {
    const all: UserSubjectCollection[] = [];
    let offset = 0;
    let total = 0;

    do {
        const res = await fetchBangumiCollectionPage(userId, apiUrl, userAgent, maxLimit, offset);
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
                    fetchAllBangumiCollections(settings.userId, settings.apiUrl, settings.userAgent),
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
                fetchAllBangumiCollections(settings.userId, settings.apiUrl, settings.userAgent),
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
                fetchAllBangumiCollections(settings.userId, settings.apiUrl, settings.userAgent),
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

export async function bangumiCrontab(db: DB, clientConfig: CacheImpl) {
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
        );
        await storeBangumiSnapshot(db, settings.userId, items);
        console.info(`[Bangumi] synced ${items.length} collections for user ${settings.userId}`);
    } catch (error) {
        // Keep the previous snapshot intact when the sync fails.
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[Bangumi] sync failed: ${message}`);
    }
}
