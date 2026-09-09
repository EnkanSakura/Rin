import { afterEach, describe, expect, it } from "bun:test";
import { startDevFetchRelay, type DevFetchRelay } from "./dev-proxy";

let relay: DevFetchRelay | null = null;
let upstream: ReturnType<typeof Bun.serve> | null = null;

afterEach(() => {
  relay?.stop();
  relay = null;
  upstream?.stop(true);
  upstream = null;
});

function startUpstream() {
  upstream = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/echo") {
        return new Response(
          JSON.stringify({
            method: request.method,
            search: url.searchParams.get("q"),
            header: request.headers.get("x-test"),
            body: request.method === "POST" ? await request.text() : null,
          }),
          { headers: { "content-type": "application/json", "x-upstream": "yes" } },
        );
      }
      if (url.pathname === "/broken") {
        return new Response("boom", { status: 503 });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return `http://127.0.0.1:${upstream.port}`;
}

describe("startDevFetchRelay", () => {
  it("rejects requests without a target", async () => {
    relay = startDevFetchRelay({ port: 0 });
    const response = await fetch(`${relay.url}/__dev_fetch`);
    expect(response.status).toBe(400);
  });

  it("rejects non-http targets", async () => {
    relay = startDevFetchRelay({ port: 0 });
    const response = await fetch(`${relay.url}/__dev_fetch`, {
      headers: { "x-rin-target": "file:///etc/passwd" },
    });
    expect(response.status).toBe(400);
  });

  it("forwards method, query, headers and body", async () => {
    const base = startUpstream();
    relay = startDevFetchRelay({ port: 0 });

    const response = await fetch(`${relay.url}/__dev_fetch`, {
      method: "POST",
      headers: { "x-rin-target": `${base}/echo?q=hello`, "x-test": "value" },
      body: "payload",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-upstream")).toBe("yes");
    expect(await response.json()).toEqual({
      method: "POST",
      search: "hello",
      header: "value",
      body: "payload",
    });
  });

  it("passes upstream error responses through", async () => {
    const base = startUpstream();
    relay = startDevFetchRelay({ port: 0 });
    const response = await fetch(`${relay.url}/__dev_fetch`, {
      headers: { "x-rin-target": `${base}/broken` },
    });
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("boom");
  });
});
