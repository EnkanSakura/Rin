/**
 * Loopback relay for outbound requests made by the locally running Worker.
 *
 * workerd's `fetch` ignores HTTP(S)_PROXY (see cloudflare/workers-sdk#6443), so
 * a local dev Worker cannot reach hosts that require a proxy. `bun dev` starts
 * this relay when `.env.local` configures a proxy; the Worker then sends its
 * outbound requests here (see server/src/utils/outbound.ts) and the relay
 * performs the real request with Bun's proxy-aware fetch.
 *
 * The relay listens on 127.0.0.1 only and is never used outside local dev.
 */

export interface DevFetchRelay {
  url: string;
  port: number;
  stop: () => void;
}

const RELAY_PATH = "/__dev_fetch";

export function startDevFetchRelay(options: { port: number; proxy?: string }): DevFetchRelay {
  const server = Bun.serve({
    port: options.port,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname !== RELAY_PATH) {
        return new Response("rin dev fetch relay", { status: 404 });
      }

      const target = request.headers.get("x-rin-target");
      if (!target) {
        return new Response("missing x-rin-target header", { status: 400 });
      }

      let targetUrl: URL;
      try {
        targetUrl = new URL(target);
      } catch {
        return new Response("invalid x-rin-target url", { status: 400 });
      }
      if (targetUrl.protocol !== "https:" && targetUrl.protocol !== "http:") {
        return new Response("unsupported protocol", { status: 400 });
      }

      const headers = new Headers(request.headers);
      headers.delete("x-rin-target");
      headers.delete("host");

      try {
        // Bun supports a per-request `proxy` option, so the proxy never has to
        // leak into process.env (which would also affect wrangler's own calls).
        const init: RequestInit & { proxy?: string } = {
          method: request.method,
          headers,
          body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
        };
        if (options.proxy) {
          init.proxy = options.proxy;
        }
        const upstream = await fetch(targetUrl, init);

        // Bun already decoded the body, so the upstream encoding/length headers
        // must not be forwarded.
        const responseHeaders = new Headers(upstream.headers);
        responseHeaders.delete("content-encoding");
        responseHeaders.delete("content-length");

        return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
      } catch (error) {
        return new Response(
          `relay upstream error: ${error instanceof Error ? error.message : String(error)}`,
          { status: 502 },
        );
      }
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    port: server.port,
    stop: () => server.stop(true),
  };
}
