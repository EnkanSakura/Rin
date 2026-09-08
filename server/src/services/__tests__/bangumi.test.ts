import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { UserSubjectCollection } from "@rin/api";
import { eq } from "drizzle-orm";
import { cleanupTestDB, setupTestApp, type TestContext } from "../../../tests/fixtures";
import { BangumiService, bangumiCrontab } from "../bangumi";
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
