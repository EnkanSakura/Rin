import { afterEach, describe, expect, it, mock } from "bun:test";

const getAppFetch = mock();

mock.module("../app-instance", () => ({
  getApp: () => ({
    fetch: getAppFetch,
  }),
}));

describe("handleFetch", () => {
  afterEach(() => {
    getAppFetch.mockReset();
  });

  it("serves static assets directly when the asset exists", async () => {
    getAppFetch.mockResolvedValue(new Response("app-body", { status: 200 }));

    const { handleFetch } = await import("../fetch-handler");
    const assetFetch = mock(async () => new Response("asset-body", { status: 200 }));

    const response = await handleFetch(
      new Request("http://localhost/assets/app.js"),
      {
        ASSETS: {
          fetch: assetFetch,
        },
      } as unknown as Env,
    );

    expect(await response.text()).toBe("asset-body");
    expect(assetFetch).toHaveBeenCalledTimes(1);
    expect(getAppFetch).toHaveBeenCalledTimes(0);
  });

  it("routes /api/blob requests to the app before static assets", async () => {
    getAppFetch.mockResolvedValue(new Response("blob-body", { status: 200 }));

    const { handleFetch } = await import("../fetch-handler");
    const assetFetch = mock(async () => new Response("asset-body", { status: 404 }));

    const executionContext = {} as ExecutionContext;
    const response = await handleFetch(
      new Request("http://localhost/api/blob/images/test.txt"),
      {
        ASSETS: {
          fetch: assetFetch,
        },
      } as unknown as Env,
      executionContext,
    );

    expect(await response.text()).toBe("blob-body");
    expect(getAppFetch).toHaveBeenCalledTimes(1);
    expect(assetFetch).toHaveBeenCalledTimes(0);
    expect(new URL(getAppFetch.mock.calls[0][0].url).pathname).toBe("/blob/images/test.txt");
    expect(getAppFetch.mock.calls[0][2]).toBe(executionContext);
  });

  it("serves a matching D1 verification TXT file as text/plain", async () => {
    getAppFetch.mockResolvedValue(new Response("app-body", { status: 200 }));
    const assetFetch = mock(async () => new Response("asset-body", { status: 200 }));
    const dbFirst = mock(async () => ({ content: "google-site-verification=abc123" }));
    const dbBind = mock(() => ({ first: dbFirst }));
    const dbPrepare = mock(() => ({ bind: dbBind }));
    const db = { prepare: dbPrepare } as unknown as D1Database;

    const { handleFetch } = await import("../fetch-handler");
    const response = await handleFetch(
      new Request("http://localhost/google123.txt"),
      {
        ASSETS: { fetch: assetFetch },
        DB: db,
      } as unknown as Env,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("google-site-verification=abc123");
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(dbPrepare).toHaveBeenCalledTimes(1);
    expect(dbBind).toHaveBeenCalledWith("/google123.txt");
    expect(assetFetch).toHaveBeenCalledTimes(0);
    expect(getAppFetch).toHaveBeenCalledTimes(0);
  });

  it("serves a .well-known D1 verification TXT file", async () => {
    const assetFetch = mock(async () => new Response("asset-body", { status: 200 }));
    const dbFirst = mock(async () => ({ content: "google-site-verification=wellknown" }));
    const dbBind = mock(() => ({ first: dbFirst }));
    const dbPrepare = mock(() => ({ bind: dbBind }));
    const db = { prepare: dbPrepare } as unknown as D1Database;

    const { handleFetch } = await import("../fetch-handler");
    const response = await handleFetch(
      new Request("http://localhost/.well-known/google456.txt"),
      {
        ASSETS: { fetch: assetFetch },
        DB: db,
      } as unknown as Env,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("google-site-verification=wellknown");
    expect(dbBind).toHaveBeenCalledWith("/.well-known/google456.txt");
    expect(assetFetch).toHaveBeenCalledTimes(0);
  });

  it("falls through to existing routing when the D1 lookup misses", async () => {
    getAppFetch.mockResolvedValue(new Response("app-body", { status: 200 }));
    const assetFetch = mock(async () => new Response("asset-body", { status: 200 }));
    const dbFirst = mock(async () => null);
    const dbBind = mock(() => ({ first: dbFirst }));
    const dbPrepare = mock(() => ({ bind: dbBind }));
    const db = { prepare: dbPrepare } as unknown as D1Database;

    const { handleFetch } = await import("../fetch-handler");
    const response = await handleFetch(
      new Request("http://localhost/fallthrough.txt"),
      {
        ASSETS: { fetch: assetFetch },
        DB: db,
      } as unknown as Env,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("asset-body");
    expect(dbPrepare).toHaveBeenCalledTimes(1);
    expect(assetFetch).toHaveBeenCalledTimes(1);
    expect(getAppFetch).toHaveBeenCalledTimes(0);
  });

  it("routes sitemap/robots meta paths to the app before static assets", async () => {
    getAppFetch.mockResolvedValue(new Response("app-body", { status: 200 }));
    const assetFetch = mock(async () => new Response("asset-body", { status: 200 }));
    const dbPrepare = mock(() => ({ bind: mock(() => ({ first: mock(async () => null) })) }));
    const db = { prepare: dbPrepare } as unknown as D1Database;

    const { handleFetch } = await import("../fetch-handler");
    const response = await handleFetch(
      new Request("http://localhost/robots.txt"),
      {
        ASSETS: { fetch: assetFetch },
        DB: db,
      } as unknown as Env,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("app-body");
    expect(getAppFetch).toHaveBeenCalledTimes(1);
    expect(assetFetch).toHaveBeenCalledTimes(0);
    expect(dbPrepare).toHaveBeenCalledTimes(0);
  });

  it("does not query D1 for non-verification paths", async () => {
    getAppFetch.mockResolvedValue(new Response("app-body", { status: 200 }));
    const assetFetch = mock(async (req: Request) => {
      const url = new URL(req.url);
      return url.pathname === "/" ? new Response("index-body", { status: 200 }) : new Response("missing", { status: 404 });
    });
    const dbPrepare = mock(() => ({ bind: mock(() => ({ first: mock(async () => null) })) }));
    const db = { prepare: dbPrepare } as unknown as D1Database;

    const { handleFetch } = await import("../fetch-handler");
    const response = await handleFetch(
      new Request("http://localhost/about"),
      {
        ASSETS: { fetch: assetFetch },
        DB: db,
      } as unknown as Env,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("index-body");
    expect(dbPrepare).toHaveBeenCalledTimes(0);
  });

  it("routes /api/*.txt to the app without touching D1", async () => {
    getAppFetch.mockResolvedValue(new Response("app-body", { status: 200 }));
    const assetFetch = mock(async () => new Response("asset-body", { status: 200 }));
    const dbPrepare = mock(() => ({ bind: mock(() => ({ first: mock(async () => null) })) }));
    const db = { prepare: dbPrepare } as unknown as D1Database;

    const { handleFetch } = await import("../fetch-handler");
    const response = await handleFetch(
      new Request("http://localhost/api/google123.txt"),
      {
        ASSETS: { fetch: assetFetch },
        DB: db,
      } as unknown as Env,
    );

    expect(await response.text()).toBe("app-body");
    expect(dbPrepare).toHaveBeenCalledTimes(0);
    expect(assetFetch).toHaveBeenCalledTimes(0);
  });
});