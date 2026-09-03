import { getApp } from "./app-instance";
import { isValidVerificationPath } from "../utils/verification-path";

const ROOT_FEED_PATTERN = /^\/(rss\.xml|atom\.xml|rss\.json|feed\.json|feed\.xml)$/;
const APP_PUBLIC_ROUTE_PATTERN = /^\/(favicon|favicon\.ico)(?:\/|$)/;

function isApiRequest(pathname: string) {
  return pathname.startsWith("/api/");
}

function rewriteApiRequest(request: Request) {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/^\/api(?=\/|$)/, "") || "/";
  return new Request(url, request);
}

function isRootFeedRequest(pathname: string) {
  return ROOT_FEED_PATTERN.test(pathname);
}

function isAppPublicRoute(pathname: string) {
  return APP_PUBLIC_ROUTE_PATTERN.test(pathname);
}

function isStaticAssetRequest(pathname: string) {
  return /\.\w+$/.test(pathname);
}

async function tryServeAsset(request: Request, env: Env) {
  if (!env.ASSETS) {
    return null;
  }

  try {
    const asset = await env.ASSETS.fetch(request);
    if (asset.status === 200 || (asset.status >= 300 && asset.status < 400)) {
      return asset;
    }
  } catch {}

  return null;
}

async function serveSpaEntry(request: Request, env: Env) {
  if (!env.ASSETS) {
    return null;
  }

  try {
    const url = new URL(request.url);
    const indexRequest = new Request(new URL("/", url.origin), request);
    const indexResponse = await env.ASSETS.fetch(indexRequest);
    if (indexResponse.status === 200 || (indexResponse.status >= 300 && indexResponse.status < 400)) {
      return indexResponse;
    }
  } catch {}

  return null;
}

/**
 * Serve domain-verification TXT files (e.g. /google123.txt, /.well-known/google123.txt)
 * from D1 when an entry exists for the request pathname. Returns null when the pathname
 * is not a legal verification path, the method is not GET/HEAD, the binding is missing,
 * the database lookup fails, or no row matches - the caller then continues with the
 * regular routing (assets, SPA, ...).
 */
async function tryServeVerificationFile(request: Request, env: Env) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return null;
  }

  if (!env.DB) {
    return null;
  }

  const pathname = new URL(request.url).pathname;
  if (!isValidVerificationPath(pathname)) {
    return null;
  }

  try {
    const row = await env.DB.prepare(
      "SELECT content FROM verification_files WHERE path = ?",
    ).bind(pathname).first();

    if (!row || typeof row.content !== "string") {
      return null;
    }

    return new Response(row.content, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    // Any database error must not break the existing routing.
    return null;
  }
}

export async function handleFetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (isRootFeedRequest(pathname)) {
    return getApp().fetch(request, env);
  }

  if (isApiRequest(pathname)) {
    return getApp().fetch(rewriteApiRequest(request), env);
  }

  if (isAppPublicRoute(pathname)) {
    return getApp().fetch(request, env);
  }

  // Domain verification TXT files from D1 take precedence over other handlers for
  // legal "*.txt" paths; when absent we continue with assets/SPA as before.
  if (isValidVerificationPath(pathname)) {
    const verificationFile = await tryServeVerificationFile(request, env);
    if (verificationFile) {
      return verificationFile;
    }
  }

  if (isStaticAssetRequest(pathname)) {
    const asset = await tryServeAsset(request, env);
    if (asset) {
      return asset;
    }
  }

  const indexResponse = await serveSpaEntry(request, env);
  if (indexResponse) {
    return indexResponse;
  }

  return new Response("Hi", { status: 200 });
}