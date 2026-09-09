import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { ToolsService } from "../tools";

const ORIGINAL_FETCH = globalThis.fetch;

function createApp() {
    return new Hono().route("/tools", ToolsService());
}

function jsonResponse(payload: unknown, status = 200) {
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

let requestedUrls: string[] = [];

beforeEach(() => {
    requestedUrls = [];
});

afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
});

describe("GET /tools/comics/platforms", () => {
    it("lists championcross as the only enabled platform", async () => {
        const response = await createApp().request("/tools/comics/platforms");
        expect(response.status).toBe(200);
        const payload = await response.json() as { platforms: Array<{ id: string; enabled: boolean }> };
        const enabled = payload.platforms.filter((platform) => platform.enabled);
        expect(enabled).toHaveLength(1);
        expect(enabled[0].id).toBe("championcross");
        expect(payload.platforms).toHaveLength(1);
    });
});

describe("GET /tools/x/media", () => {
    it("rejects invalid input", async () => {
        const response = await createApp().request("/tools/x/media?url=not-a-tweet");
        expect(response.status).toBe(400);
        const payload = await response.json() as { error: { message: string } };
        expect(payload.error.message).toBe("invalid_tweet_url");
    });

    it("returns normalized media from fxtwitter", async () => {
        globalThis.fetch = (async (input: unknown) => {
            const url = new URL(String(input));
            requestedUrls.push(url.toString());
            if (url.hostname === "api.fxtwitter.com") {
                return jsonResponse({
                    code: 200,
                    status: {
                        id: "1440467865409179657",
                        url: "https://x.com/espn/status/1440467865409179657",
                        text: "IT'S BACK",
                        author: { screen_name: "espn", name: "ESPN" },
                        media: {
                            all: [
                                {
                                    id: "m1",
                                    type: "video",
                                    url: "https://video.twimg.com/a.mp4",
                                    width: 720,
                                    height: 720,
                                    duration: 60,
                                },
                            ],
                        },
                    },
                });
            }
            return new Response("nope", { status: 404 });
        }) as unknown as typeof fetch;

        const response = await createApp().request("/tools/x/media?url=https%3A%2F%2Fx.com%2Fespn%2Fstatus%2F1440467865409179657");
        expect(response.status).toBe(200);
        const payload = await response.json() as { tweetId: string; media: Array<{ url: string; kind: string }> };
        expect(payload.tweetId).toBe("1440467865409179657");
        expect(payload.media).toEqual([expect.objectContaining({ kind: "video", url: "https://video.twimg.com/a.mp4" })]);
        expect(requestedUrls).toHaveLength(1);
    });

    it("falls back to vxtwitter when fxtwitter fails", async () => {
        globalThis.fetch = (async (input: unknown) => {
            const url = new URL(String(input));
            requestedUrls.push(url.toString());
            if (url.hostname === "api.vxtwitter.com") {
                return jsonResponse({
                    tweetURL: "https://twitter.com/user/status/555",
                    user_name: "User",
                    user_screen_name: "user",
                    text: "hi",
                    media_extended: [{ type: "gif", url: "https://video.twimg.com/g.mp4" }],
                });
            }
            return new Response("down", { status: 502 });
        }) as unknown as typeof fetch;

        const response = await createApp().request("/tools/x/media?url=555");
        expect(response.status).toBe(200);
        const payload = await response.json() as { source: string; media: Array<{ kind: string }> };
        expect(payload.source).toBe("vxtwitter");
        expect(payload.media[0].kind).toBe("gif");
        expect(requestedUrls).toHaveLength(3);
    });

    it("returns 502 when every upstream fails", async () => {
        globalThis.fetch = (async () => new Response("down", { status: 500 })) as unknown as typeof fetch;
        const response = await createApp().request("/tools/x/media?url=555");
        expect(response.status).toBe(502);
    });
});

describe("GET /tools/x/proxy", () => {
    it("rejects non twimg urls", async () => {
        const response = await createApp().request("/tools/x/proxy?url=https%3A%2F%2Fevil.com%2Fa.mp4");
        expect(response.status).toBe(400);
    });

    it("streams the upstream body with an attachment name", async () => {
        globalThis.fetch = (async () =>
            new Response(new Uint8Array([1, 2, 3]), {
                headers: { "content-type": "video/mp4", "content-length": "3" },
            })) as unknown as typeof fetch;

        const response = await createApp().request(
            "/tools/x/proxy?url=https%3A%2F%2Fvideo.twimg.com%2Fa.mp4&name=clip.mp4",
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("video/mp4");
        expect(response.headers.get("content-disposition")).toContain('filename="clip.mp4"');
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    });
});

describe("POST /tools/comics/championcross/resolve", () => {
    it("rejects foreign urls", async () => {
        const response = await createApp().request("/tools/comics/championcross/resolve", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: "https://evil.com/episodes/ep1" }),
        });
        expect(response.status).toBe(400);
    });

    it("returns the chapter catalog", async () => {
        globalThis.fetch = (async (input: unknown) => {
            const url = new URL(String(input));
            if (url.pathname === "/episodes/ep1") {
                return new Response('<html data-api-domain="/api"></html>');
            }
            if (url.pathname === "/api/episodes/ep1") {
                return jsonResponse({
                    episode: {
                        id: "ep1",
                        summary: { title: "第1話" },
                        series: { id: "series1", name: "Series" },
                        content: [{ viewerId: "viewer-1" }],
                    },
                });
            }
            if (url.pathname === "/api/episodes") {
                return jsonResponse({ series: { episodes: [{ id: "ep1", title: "第1話" }] } });
            }
            if (url.pathname === "/api/series/access") {
                return jsonResponse({ seriesAccess: { episodeAccesses: [] } });
            }
            return new Response("not found", { status: 404 });
        }) as unknown as typeof fetch;

        const response = await createApp().request("/tools/comics/championcross/resolve", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: "https://championcross.jp/episodes/ep1" }),
        });
        expect(response.status).toBe(200);
        const payload = await response.json() as { platform: string; episodeTitle: string; chapters: unknown[] };
        expect(payload.platform).toBe("championcross");
        expect(payload.episodeTitle).toBe("第1話");
        expect(payload.chapters).toHaveLength(1);
    });
});

describe("POST /tools/comics/championcross/pages", () => {
    it("refuses chapters that are not readable for free", async () => {
        globalThis.fetch = (async (input: unknown) => {
            const url = new URL(String(input));
            if (url.pathname === "/episodes/ep1") {
                return new Response("<html></html>");
            }
            return jsonResponse({ episode: { id: "ep1", summary: { title: "第1話" }, series: {}, content: [] } });
        }) as unknown as typeof fetch;

        const response = await createApp().request("/tools/comics/championcross/pages", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ episodeUrl: "https://championcross.jp/episodes/ep1" }),
        });
        expect(response.status).toBe(403);
    });

    it("returns the page list with scramble orders", async () => {
        globalThis.fetch = (async (input: unknown) => {
            const url = new URL(String(input));
            if (url.pathname === "/episodes/ep1") {
                return new Response('<html comici-viewer-id="page-viewer"></html>');
            }
            if (url.pathname === "/api/episodes/ep1") {
                return jsonResponse({
                    episode: { id: "ep1", summary: { title: "第1話" }, series: { id: "s1" }, content: [{ viewerId: "viewer-1" }] },
                });
            }
            if (url.pathname === "/api/book/contentsInfo") {
                return jsonResponse({
                    totalPages: 2,
                    result: [
                        { imageUrl: "https://viewer.championcross.jp/p1.jpg", scramble: "[1, 0]", sort: 0, width: 777, height: 1200 },
                        { imageUrl: "https://viewer.championcross.jp/p2.jpg", scramble: null, sort: 1 },
                    ],
                });
            }
            return new Response("not found", { status: 404 });
        }) as unknown as typeof fetch;

        const response = await createApp().request("/tools/comics/championcross/pages", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ episodeUrl: "https://championcross.jp/episodes/ep1" }),
        });
        expect(response.status).toBe(200);
        const payload = await response.json() as { pages: Array<{ url: string; scramble: number[] | null }> };
        expect(payload.pages).toHaveLength(2);
        expect(payload.pages[0].scramble).toEqual([1, 0]);
        expect(payload.pages[1].scramble).toBeNull();
    });
});

describe("GET /tools/comics/championcross/image", () => {
    it("requires an episode referer", async () => {
        const response = await createApp().request(
            "/tools/comics/championcross/image?url=https%3A%2F%2Fviewer.championcross.jp%2Fp1.jpg",
        );
        expect(response.status).toBe(400);
    });

    it("sends the championcross image headers upstream", async () => {
        let seenHeaders: Headers | undefined;
        globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
            seenHeaders = new Headers(init?.headers);
            return new Response(new Uint8Array([9]), { headers: { "content-type": "image/jpeg" } });
        }) as unknown as typeof fetch;

        const response = await createApp().request(
            "/tools/comics/championcross/image?url=https%3A%2F%2Fviewer.championcross.jp%2Fp1.jpg&referer=https%3A%2F%2Fchampioncross.jp%2Fepisodes%2Fep1",
        );
        expect(response.status).toBe(200);
        expect(seenHeaders?.get("referer")).toBe("https://championcross.jp/episodes/ep1");
        expect(seenHeaders?.get("origin")).toBe("https://championcross.jp");
    });
});
