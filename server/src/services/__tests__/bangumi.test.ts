import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { UserSubjectCollection } from "@rin/api";
import { eq } from "drizzle-orm";
import { cleanupTestDB, setupTestApp, type TestContext } from "../../../tests/fixtures";
import { BangumiService, bangumiCrontab, fetchAllBangumiCollections } from "../bangumi";
import { bangumiCache } from "../../db/schema";

const ORIGINAL_FETCH = globalThis.fetch;

function makeItem(id: number): UserSubjectCollection {
    return {
        subject_id: id,
        subject_type: 2,
        type: 2,
        rate: 8,
        comment: null,
        tags: [],
        ep_status: 0,
        vol_status: 0,
        updated_at: "2024-01-01T00:00:00.000Z",
        private: false,
        subject: {
            id,
            type: 2,
            name: `Subject ${id}`,
            name_cn: "",
            short_summary: "",
            date: null,
            images: { large: "", common: "", medium: "", small: "", grid: "" },
            volumes: 0,
            eps: 0,
            collection_total: 0,
            score: 0,
            rank: 0,
            tags: [],
        },
    } as UserSubjectCollection;
}

function makeItems(count: number, startId = 1): UserSubjectCollection[] {
    return Array.from({ length: count }, (_, i) => makeItem(startId + i));
}

let fetchCalls: string[] = [];

function mockBangumiApi(items: UserSubjectCollection[]) {
    fetchCalls = [];
    globalThis.fetch = (async (input: unknown) => {
        const url = new URL(typeof input === "string" ? input : (input as Request).url);
        fetchCalls.push(url.toString());
        const offset = Number(url.searchParams.get("offset") ?? "0");
        const limit = Number(url.searchParams.get("limit") ?? "100");
        const data = items.slice(offset, offset + limit);
        return new Response(JSON.stringify({ data, total: items.length, limit, offset }), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    }) as typeof fetch;
}

function mockBangumiApiFailure() {
    fetchCalls = [];
    globalThis.fetch = (async () => new Response("boom", { status: 500 })) as typeof fetch;
}

async function configureBangumi(ctx: TestContext, overrides: Record<string, unknown> = {}) {
    await ctx.clientConfig.set("bangumi.userId", "123456");
    await ctx.clientConfig.set("bangumi.apiUrl", "https://api.bgm.tv");
    await ctx.clientConfig.set("bangumi.userAgent", "Rin-Test/1.0");
    for (const [key, value] of Object.entries(overrides)) {
        await ctx.clientConfig.set(key, value);
    }
}

function seedSnapshot(ctx: TestContext, userId: string, items: UserSubjectCollection[], ageSeconds = 0) {
    const payload = JSON.stringify(items);
    ctx.sqlite.exec(
        `INSERT INTO bangumi_cache (user_id, data, total, updated_at)
         VALUES ('${userId}', '${payload}', ${items.length}, ${Math.floor(Date.now() / 1000) - ageSeconds})`,
    );
}

function countSnapshots(ctx: TestContext): number {
    return (ctx.sqlite.query("SELECT COUNT(*) AS n FROM bangumi_cache").get() as { n: number }).n;
}

async function readSnapshot(ctx: TestContext, userId: string) {
    const rows = await (ctx.db as any).select().from(bangumiCache).where(eq(bangumiCache.userId, userId));
    return rows[0] ?? null;
}

function asBody(res: Response) {
    return res.json() as Promise<any>;
}

/** Runs `fn` against an app whose env carries the local dev relay address. */
async function withRelayApp<T>(fn: (relayCtx: TestContext) => Promise<T>): Promise<T> {
    const relayCtx = await setupTestApp(BangumiService, {
        DEV_FETCH_RELAY: "http://127.0.0.1:11500",
    });
    try {
        return await fn(relayCtx);
    } finally {
        cleanupTestDB(relayCtx.sqlite);
    }
}

/** Records relay calls and answers them with a paginated collection payload. */
function mockRelayFetch(items: UserSubjectCollection[]) {
    const calls: { url: string; target: string | null }[] = [];
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        const headers = new Headers(init?.headers ?? (input as Request).headers);
        const target = headers.get("x-rin-target");
        calls.push({ url, target });
        const targetUrl = new URL(target ?? url);
        const offset = Number(targetUrl.searchParams.get("offset") ?? "0");
        const limit = Number(targetUrl.searchParams.get("limit") ?? "100");
        return new Response(
            JSON.stringify({ data: items.slice(offset, offset + limit), total: items.length, limit, offset }),
            { status: 200, headers: { "content-type": "application/json" } },
        );
    }) as typeof fetch;
    return calls;
}

afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
});

describe("GET /api/bangumi", () => {
    let ctx: TestContext;

    beforeEach(async () => {
        ctx = await setupTestApp(BangumiService);
    });

    afterEach(() => {
        cleanupTestDB(ctx.sqlite);
    });

    it("404 when no Bangumi user id is configured", async () => {
        const res = await ctx.app.request("/");
        expect(res.status).toBe(404);
        expect(await res.text()).toBe("Bangumi not configured");
    });

    it("realtime mode fetches live and never writes a snapshot", async () => {
        const items = makeItems(250);
        mockBangumiApi(items);
        await configureBangumi(ctx, { "bangumi.updateMode": "realtime" });

        const res = await ctx.app.request("/");
        expect(res.status).toBe(200);
        const body = await asBody(res);
        expect(body.mode).toBe("realtime");
        expect(body.total).toBe(250);
        expect(body.updatedAt).toBeNull();
        expect(body.data).toHaveLength(250);
        // 250 items paginated at 100 → 3 upstream calls
        expect(fetchCalls).toHaveLength(3);
        expect(countSnapshots(ctx)).toBe(0);
    });

    it("auto mode without a snapshot hydrates and stores it, then serves from D1", async () => {
        const items = makeItems(120);
        mockBangumiApi(items);
        await configureBangumi(ctx, { "bangumi.updateMode": "auto" });

        const res1 = await ctx.app.request("/");
        expect(res1.status).toBe(200);
        const body1 = await asBody(res1);
        expect(body1.mode).toBe("auto");
        expect(body1.data).toHaveLength(120);
        expect(typeof body1.updatedAt).toBe("number");
        expect(fetchCalls.length).toBeGreaterThan(0);
        expect(countSnapshots(ctx)).toBe(1);

        const callsAfterFirst = fetchCalls.length;
        const res2 = await ctx.app.request("/");
        const body2 = await asBody(res2);
        expect(res2.status).toBe(200);
        expect(body2.data).toHaveLength(120);
        // second request is served from D1 without hitting the Bangumi API
        expect(fetchCalls.length).toBe(callsAfterFirst);
    });

    it("auto mode serves an existing snapshot without touching the Bangumi API", async () => {
        mockBangumiApi(makeItems(50));
        seedSnapshot(ctx, "123456", makeItems(7, 900));
        await configureBangumi(ctx, { "bangumi.updateMode": "auto" });

        const res = await ctx.app.request("/");
        expect(res.status).toBe(200);
        const body = await asBody(res);
        expect(body.mode).toBe("auto");
        expect(body.data).toHaveLength(7);
        expect(body.data[0].subject_id).toBe(900);
        expect(fetchCalls).toHaveLength(0);
    });

    it("auto mode refetches when the snapshot belongs to another user", async () => {
        const items = makeItems(30);
        mockBangumiApi(items);
        seedSnapshot(ctx, "other-user", makeItems(5, 700));
        await configureBangumi(ctx, { "bangumi.updateMode": "auto" });

        const res = await ctx.app.request("/");
        expect(res.status).toBe(200);
        const body = await asBody(res);
        expect(body.total).toBe(30);
        expect(fetchCalls.length).toBeGreaterThan(0);

        const row = await readSnapshot(ctx, "123456");
        expect(row).not.toBeNull();
        expect(row.total).toBe(30);
        // the other user's row is left untouched
        const otherRow = await readSnapshot(ctx, "other-user");
        expect(otherRow).not.toBeNull();
    });

    it("auto mode falls back to the snapshot when the live fetch fails", async () => {
        mockBangumiApiFailure();
        seedSnapshot(ctx, "123456", makeItems(4, 500));
        await configureBangumi(ctx, { "bangumi.updateMode": "auto" });

        const res = await ctx.app.request("/");
        expect(res.status).toBe(200);
        const body = await asBody(res);
        expect(body.data).toHaveLength(4);
        expect(fetchCalls).toHaveLength(0);
    });

    it("auto mode without a snapshot returns 502 when the live fetch fails", async () => {
        mockBangumiApiFailure();
        await configureBangumi(ctx, { "bangumi.updateMode": "auto" });

        const res = await ctx.app.request("/");
        expect(res.status).toBe(502);
        expect(await res.text()).toContain("Bangumi API error");
        expect(countSnapshots(ctx)).toBe(0);
    });

    it("realtime mode returns 502 when the Bangumi API is down", async () => {
        mockBangumiApiFailure();
        await configureBangumi(ctx, { "bangumi.updateMode": "realtime" });

        const res = await ctx.app.request("/");
        expect(res.status).toBe(502);
    });
});

describe("POST /api/bangumi/update", () => {
    let ctx: TestContext;

    beforeEach(async () => {
        ctx = await setupTestApp(BangumiService);
    });

    afterEach(() => {
        cleanupTestDB(ctx.sqlite);
    });

    it("404 when no user id is configured", async () => {
        const res = await ctx.app.request("/update", { method: "POST" });
        expect(res.status).toBe(404);
    });

    it("400 when update mode is not auto", async () => {
        mockBangumiApi(makeItems(10));
        await configureBangumi(ctx, { "bangumi.updateMode": "realtime" });
        const res = await ctx.app.request("/update", { method: "POST" });
        expect(res.status).toBe(400);
        expect(fetchCalls).toHaveLength(0);
    });

    it("syncs and stores a fresh snapshot when none exists", async () => {
        mockBangumiApi(makeItems(50));
        await configureBangumi(ctx, { "bangumi.updateMode": "auto" });

        const res = await ctx.app.request("/update", { method: "POST" });
        expect(res.status).toBe(200);
        const body = await asBody(res);
        expect(body.mode).toBe("auto");
        expect(body.updated).toBe(true);
        expect(body.total).toBe(50);
        expect(body.data).toHaveLength(50);
        expect(fetchCalls.length).toBeGreaterThan(0);
        expect(countSnapshots(ctx)).toBe(1);
    });

    it("refetches when the stored snapshot is older than the throttle window", async () => {
        mockBangumiApi(makeItems(50));
        seedSnapshot(ctx, "123456", makeItems(3, 300), 60 * 60); // 1 hour old
        await configureBangumi(ctx, { "bangumi.updateMode": "auto" });

        const res = await ctx.app.request("/update", { method: "POST" });
        expect(res.status).toBe(200);
        const body = await asBody(res);
        expect(body.updated).toBe(true);
        expect(body.data).toHaveLength(50);
        const row = await readSnapshot(ctx, "123456");
        expect(row.total).toBe(50);
    });

    it("returns the stored snapshot without hitting the API within the throttle window", async () => {
        mockBangumiApi(makeItems(50));
        seedSnapshot(ctx, "123456", makeItems(3, 300), 0); // just stored
        await configureBangumi(ctx, { "bangumi.updateMode": "auto" });

        const res = await ctx.app.request("/update", { method: "POST" });
        expect(res.status).toBe(200);
        const body = await asBody(res);
        expect(body.updated).toBe(false);
        expect(body.data).toHaveLength(3);
        expect(fetchCalls).toHaveLength(0);
    });

    it("returns 502 when the live fetch fails and no snapshot exists", async () => {
        mockBangumiApiFailure();
        await configureBangumi(ctx, { "bangumi.updateMode": "auto" });

        const res = await ctx.app.request("/update", { method: "POST" });
        expect(res.status).toBe(502);
        expect(countSnapshots(ctx)).toBe(0);
    });
});

describe("bangumiCrontab", () => {
    let ctx: TestContext;

    beforeEach(async () => {
        ctx = await setupTestApp(BangumiService);
    });

    afterEach(() => {
        cleanupTestDB(ctx.sqlite);
    });

    it("skips when update mode is realtime", async () => {
        mockBangumiApi(makeItems(10));
        await configureBangumi(ctx, { "bangumi.updateMode": "realtime" });
        await bangumiCrontab(ctx.db, ctx.clientConfig);
        expect(fetchCalls).toHaveLength(0);
        expect(countSnapshots(ctx)).toBe(0);
    });

    it("skips when no user id is configured", async () => {
        mockBangumiApi(makeItems(10));
        await ctx.clientConfig.set("bangumi.updateMode", "auto");
        await bangumiCrontab(ctx.db, ctx.clientConfig);
        expect(fetchCalls).toHaveLength(0);
    });

    it("syncs when auto mode has no snapshot yet", async () => {
        mockBangumiApi(makeItems(200));
        await configureBangumi(ctx, { "bangumi.updateMode": "auto" });

        await bangumiCrontab(ctx.db, ctx.clientConfig);
        expect(fetchCalls.length).toBeGreaterThan(0);
        const row = await readSnapshot(ctx, "123456");
        expect(row).not.toBeNull();
        expect(row.total).toBe(200);
    });

    it("skips the sync while the snapshot is still fresh", async () => {
        mockBangumiApi(makeItems(200));
        seedSnapshot(ctx, "123456", makeItems(3, 300), 60 * 60); // 1 hour old
        await configureBangumi(ctx, { "bangumi.updateMode": "auto" });

        await bangumiCrontab(ctx.db, ctx.clientConfig);
        expect(fetchCalls).toHaveLength(0);
    });

    it("re-syncs when the snapshot is stale and keeps previous data on failure", async () => {
        const items = makeItems(200);
        mockBangumiApi(items);
        seedSnapshot(ctx, "123456", makeItems(3, 300), 24 * 60 * 60); // 1 day old
        await configureBangumi(ctx, { "bangumi.updateMode": "auto" });

        await bangumiCrontab(ctx.db, ctx.clientConfig);
        expect(fetchCalls.length).toBeGreaterThan(0);
        const row = await readSnapshot(ctx, "123456");
        expect(row.total).toBe(200);

        // failure keeps the last good snapshot intact
        mockBangumiApiFailure();
        await bangumiCrontab(ctx.db, ctx.clientConfig);
        const afterFailure = await readSnapshot(ctx, "123456");
        expect(afterFailure.total).toBe(200);
    });
});

describe("GET /api/bangumi/cover", () => {
    let ctx: TestContext;

    beforeEach(async () => {
        ctx = await setupTestApp(BangumiService);
    });

    afterEach(() => {
        cleanupTestDB(ctx.sqlite);
    });

    it("rejects sources that are not Bangumi hosts", async () => {
        mockBangumiApi([]);
        for (const src of [
            "http://127.0.0.1:11498/api/config",
            "https://example.com/cover.jpg",
            "file:///etc/passwd",
            "not-a-url",
        ]) {
            const res = await ctx.app.request(`/cover?src=${encodeURIComponent(src)}`);
            expect(res.status).toBe(400);
        }
        expect(fetchCalls).toHaveLength(0);
    });

    it("rejects a missing source", async () => {
        const res = await ctx.app.request("/cover");
        expect(res.status).toBe(400);
    });

    it("proxies a Bangumi cover with long-lived cache headers", async () => {
        fetchCalls = [];
        globalThis.fetch = (async (input: unknown) => {
            fetchCalls.push(String(input));
            return new Response(new Uint8Array([1, 2, 3, 4]), {
                status: 200,
                headers: { "content-type": "image/jpeg" },
            });
        }) as typeof fetch;

        const src = "https://lain.bgm.tv/pic/cover/l/ab/cd/123.jpg";
        const res = await ctx.app.request(`/cover?src=${encodeURIComponent(src)}`);

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("image/jpeg");
        expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
        expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
        expect(fetchCalls).toEqual([src]);
    });

    it("reports an upstream failure as 502", async () => {
        mockBangumiApiFailure();
        const src = "https://lain.bgm.tv/pic/cover/l/ab/cd/404.jpg";
        const res = await ctx.app.request(`/cover?src=${encodeURIComponent(src)}`);
        expect(res.status).toBe(502);
    });

    it("rejects an upstream error document served with a 200", async () => {
        globalThis.fetch = (async () =>
            new Response("<html>nope</html>", {
                status: 200,
                headers: { "content-type": "text/html" },
            })) as typeof fetch;

        const src = "https://lain.bgm.tv/pic/cover/l/ab/cd/blocked.jpg";
        const res = await ctx.app.request(`/cover?src=${encodeURIComponent(src)}`);
        expect(res.status).toBe(502);
    });
});

describe("Bangumi collection fetch", () => {
    let ctx: TestContext;

    beforeEach(async () => {
        ctx = await setupTestApp(BangumiService);
    });

    afterEach(() => {
        cleanupTestDB(ctx.sqlite);
    });

    it("uses the injected fetch implementation and paginates", async () => {
        const items = makeItems(205);
        const seen: string[] = [];
        const impl = (async (input: unknown) => {
            const url = new URL(String(input));
            seen.push(url.toString());
            const offset = Number(url.searchParams.get("offset") ?? "0");
            const limit = Number(url.searchParams.get("limit") ?? "100");
            return new Response(
                JSON.stringify({ data: items.slice(offset, offset + limit), total: items.length, limit, offset }),
                { status: 200, headers: { "content-type": "application/json" } },
            );
        }) as typeof fetch;

        const all = await fetchAllBangumiCollections("42", "https://api.bgm.tv", "ua", 100, impl);

        expect(all).toHaveLength(205);
        expect(seen).toHaveLength(3);
        expect(seen[0]).toContain("/v0/users/42/collections");
        expect(seen[2]).toContain("offset=200");
    });

    it("uses the injected fetch implementation for the scheduled sync", async () => {
        const items = makeItems(2);
        const seen: string[] = [];
        const impl = (async (input: unknown) => {
            seen.push(String(input));
            return new Response(
                JSON.stringify({ data: items, total: items.length, limit: 100, offset: 0 }),
                { status: 200, headers: { "content-type": "application/json" } },
            );
        }) as typeof fetch;

        await configureBangumi(ctx, { "bangumi.updateMode": "auto" });
        await bangumiCrontab(ctx.db, ctx.clientConfig, impl);

        expect(seen).toHaveLength(1);
        expect(seen[0]).toContain("/v0/users/123456/collections");
        expect((await readSnapshot(ctx, "123456")).total).toBe(2);
    });

    it("routes the live fetch through DEV_FETCH_RELAY when the dev relay is configured", async () => {
        // Only meaningful in local dev: `.dev.vars` sets DEV_FETCH_RELAY and the
        // Worker must send its upstream calls to that loopback relay instead of
        // opening a direct socket (workerd ignores HTTP(S)_PROXY).
        await withRelayApp(async (relayCtx) => {
            const items = makeItems(3);
            const calls = mockRelayFetch(items);

            await configureBangumi(relayCtx, { "bangumi.updateMode": "realtime" });
            const res = await relayCtx.app.request("/");

            expect(res.status).toBe(200);
            expect(await asBody(res)).toMatchObject({ mode: "realtime", total: 3 });
            expect(calls).toHaveLength(1);
            expect(calls[0]!.url).toBe("http://127.0.0.1:11500/__dev_fetch");
            expect(calls[0]!.target).toContain("https://api.bgm.tv/v0/users/123456/collections");
        });
    });

    it("routes the cover fetch through DEV_FETCH_RELAY when the dev relay is configured", async () => {
        await withRelayApp(async (relayCtx) => {
            const calls: { url: string; target: string | null }[] = [];
            globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
                const url = typeof input === "string" ? input : (input as Request).url;
                const headers = new Headers(init?.headers ?? (input as Request).headers);
                calls.push({ url, target: headers.get("x-rin-target") });
                return new Response(new Uint8Array([1, 2, 3]), {
                    status: 200,
                    headers: { "content-type": "image/jpeg" },
                });
            }) as typeof fetch;

            const src = "https://lain.bgm.tv/pic/cover/l/ab/cd/123.jpg";
            const res = await relayCtx.app.request(`/cover?src=${encodeURIComponent(src)}`);

            expect(res.status).toBe(200);
            expect(calls).toHaveLength(1);
            expect(calls[0]!.url).toBe("http://127.0.0.1:11500/__dev_fetch");
            expect(calls[0]!.target).toBe(src);
        });
    });
});
