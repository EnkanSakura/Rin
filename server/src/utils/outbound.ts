/**
 * Outbound fetch used by the tool services.
 *
 * `fetch` inside workerd ignores HTTP(S)_PROXY, so a locally running Worker
 * cannot reach hosts that need a proxy (championcross.jp, twimg.com, ...).
 * When the dev CLI starts its loopback relay it writes `DEV_FETCH_RELAY` into
 * `.dev.vars`; every outbound call is then sent to that relay, which performs
 * the real request in a proxy-aware runtime. In production the variable is
 * absent and plain `fetch` is used.
 */
export function createOutboundFetch(env?: Env): typeof fetch {
  const relay = env?.DEV_FETCH_RELAY;
  if (!relay) {
    return fetch;
  }

  const base = relay.replace(/\/+$/, "");

  const relayed = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = typeof input === "object" && !(input instanceof URL) ? input : null;
    const target = request ? request.url : input.toString();
    if (!/^https?:\/\//i.test(target)) {
      return fetch(input, init);
    }

    const headers = new Headers(init?.headers ?? request?.headers);
    headers.set("x-rin-target", target);
    headers.delete("host");

    const method = init?.method ?? request?.method ?? "GET";
    const body =
      init?.body ?? (method === "GET" || method === "HEAD" ? undefined : request?.body);

    return fetch(`${base}/__dev_fetch`, {
      method,
      headers,
      body: body as BodyInit | null | undefined,
    });
  };

  return relayed as unknown as typeof fetch;
}
