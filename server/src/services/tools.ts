import type {
  ComicPagesResponse,
  ComicPlatformListResponse,
  ComicResolveResponse,
  XMediaItem,
  XTweetMediaResponse,
} from "@rin/api";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppContext } from "../core/hono-types";
import {
  fetchChapterPages,
  fetchEpisodeDetail,
  imageHeaders,
  isAllowedChampionCrossUrl,
  normalizeEpisodeUrl,
  parseApiOrigin,
  parsePageViewerId,
  browserHeaders,
  resolveChampionCrossEpisode,
} from "../utils/championcross";
import {
  isAllowedTwitterMediaUrl,
  normalizeFxTwitterV1,
  normalizeFxTwitterV2,
  normalizeVxTwitter,
  parseTweetId,
} from "../utils/x-media";
import { createOutboundFetch } from "../utils/outbound";

const UPSTREAM_TIMEOUT_MS = 30_000;
const MAX_PROXY_BYTES = 200 * 1024 * 1024;

/**
 * Platforms offered by the comic downloader. New platforms are added here
 * together with their own route group under /tools/comics/<id>.
 */
const COMIC_PLATFORMS: ComicPlatformListResponse["platforms"] = [
  {
    id: "championcross",
    name: "Champion Cross",
    enabled: true,
    homepage: "https://championcross.jp/",
    note: "championcross.episode_url_hint",
  },
];

function fail(c: AppContext, message: string, status: ContentfulStatusCode = 400) {
  return c.json({ error: { message } }, status);
}

function withTimeout(): AbortSignal {
  return AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
}

function sanitizeFileName(value: string | undefined, fallback: string): string {
  const cleaned = (value ?? "")
    .replace(/[\r\n"\\]/g, "")
    .replace(/[/\\?%*:|<>]/g, "_")
    .trim();
  return cleaned || fallback;
}

function fileNameFromUrl(url: string, fallback: string): string {
  try {
    const base = new URL(url).pathname.split("/").filter(Boolean).pop();
    return base ? decodeURIComponent(base) : fallback;
  } catch {
    return fallback;
  }
}

/** Streams an upstream response back to the browser without buffering it. */
async function streamUpstream(
  fetchImpl: typeof fetch,
  target: string,
  headers: Record<string, string>,
  options: { fileName?: string; contentTypeFallback?: string } = {},
): Promise<Response> {
  // Streaming responses must not carry an abort signal: workerd rejects a
  // fetch whose body is piped out after the signal has been created here.
  const upstream = await fetchImpl(target, { headers });
  if (!upstream.ok || !upstream.body) {
    return new Response(`upstream ${upstream.status}`, { status: 502 });
  }

  const length = Number(upstream.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_PROXY_BYTES) {
    return new Response("upstream file is too large", { status: 413 });
  }

  // Only the content type is forwarded: workerd's fetch already decodes
  // content-encoding, so re-emitting content-length would truncate the body.
  const outHeaders = new Headers();
  outHeaders.set(
    "content-type",
    upstream.headers.get("content-type") ?? options.contentTypeFallback ?? "application/octet-stream",
  );
  outHeaders.set("cache-control", "public, max-age=600");
  if (options.fileName) {
    const encoded = encodeURIComponent(options.fileName);
    outHeaders.set(
      "content-disposition",
      `attachment; filename="${options.fileName.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encoded}`,
    );
  }

  return new Response(upstream.body, { status: 200, headers: outHeaders });
}

/**
 * Resolves an X (Twitter) post to direct media urls.
 *
 * Primary upstream is the public FxTwitter API; vxtwitter is used as a
 * fallback when the former fails.
 */
async function resolveTweetMedia(
  fetchImpl: typeof fetch,
  tweetId: string,
): Promise<XTweetMediaResponse | null> {
  const attempts: Array<() => Promise<XTweetMediaResponse | null>> = [
    async () => {
      const response = await fetchImpl(`https://api.fxtwitter.com/2/status/${tweetId}`, {
        headers: { accept: "application/json", "user-agent": "Rin-Tools/1.0" },
        signal: withTimeout(),
      });
      if (!response.ok) return null;
      return normalizeFxTwitterV2(await response.json());
    },
    async () => {
      const response = await fetchImpl(`https://api.fxtwitter.com/i/status/${tweetId}`, {
        headers: { accept: "application/json", "user-agent": "Rin-Tools/1.0" },
        signal: withTimeout(),
      });
      if (!response.ok) return null;
      return normalizeFxTwitterV1(await response.json(), tweetId);
    },
    async () => {
      const response = await fetchImpl(`https://api.vxtwitter.com/Twitter/status/${tweetId}`, {
        headers: { accept: "application/json", "user-agent": "Rin-Tools/1.0" },
        signal: withTimeout(),
      });
      if (!response.ok) return null;
      return normalizeVxTwitter(await response.json(), tweetId);
    },
  ];

  for (const attempt of attempts) {
    try {
      const result = await attempt();
      if (result) {
        return result;
      }
    } catch {
      // try the next upstream
    }
  }
  return null;
}

function dedupeMedia(media: XMediaItem[]): XMediaItem[] {
  const seen = new Set<string>();
  return media.filter((item) => {
    const key = item.url.split("?")[0] ?? item.url;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function ToolsService(): Hono {
  const app = new Hono();

  // ---------------------------------------------------------------- X media
  // GET /tools/x/media?url=<tweet url or id>
  app.get("/x/media", async (c: AppContext) => {
    const input = c.req.query("url") ?? "";
    const tweetId = parseTweetId(input);
    if (!tweetId) {
      return fail(c, "invalid_tweet_url");
    }

    const resolved = await resolveTweetMedia(createOutboundFetch(c.env), tweetId);
    if (!resolved) {
      return fail(c, "tweet_resolve_failed", 502);
    }

    return c.json({ ...resolved, media: dedupeMedia(resolved.media) });
  });

  // GET /tools/x/proxy?url=<twimg url>&name=<file name>
  app.get("/x/proxy", async (c: AppContext) => {
    const target = c.req.query("url") ?? "";
    if (!isAllowedTwitterMediaUrl(target)) {
      return fail(c, "invalid_media_url");
    }
    const fileName = sanitizeFileName(c.req.query("name"), fileNameFromUrl(target, "x-media"));
    return streamUpstream(createOutboundFetch(c.env), target, {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      accept: "*/*",
    }, { fileName });
  });

  // ------------------------------------------------------------ Comic list
  // GET /tools/comics/platforms
  app.get("/comics/platforms", (c: AppContext) => {
    return c.json({ platforms: COMIC_PLATFORMS } satisfies ComicPlatformListResponse);
  });

  // ------------------------------------------------- Champion Cross routes
  // POST /tools/comics/championcross/resolve
  app.post("/comics/championcross/resolve", async (c: AppContext) => {
    const body = await c.req.json().catch(() => null);
    const rawUrl = typeof body?.url === "string" ? body.url : "";
    if (!normalizeEpisodeUrl(rawUrl)) {
      return fail(c, "invalid_episode_url");
    }

    try {
      const result = await resolveChampionCrossEpisode(createOutboundFetch(c.env), rawUrl);
      const payload: ComicResolveResponse = {
        platform: "championcross",
        episodeId: result.detail.episodeId,
        episodeTitle: result.detail.title,
        seriesId: result.detail.seriesId || undefined,
        seriesTitle: result.detail.seriesTitle || undefined,
        chapters: result.chapters,
      };
      return c.json(payload);
    } catch (error) {
      return fail(c, error instanceof Error ? error.message : "resolve_failed", 502);
    }
  });

  // POST /tools/comics/championcross/pages
  app.post("/comics/championcross/pages", async (c: AppContext) => {
    const body = await c.req.json().catch(() => null);
    const rawUrl = typeof body?.episodeUrl === "string" ? body.episodeUrl : "";
    const episodeUrl = normalizeEpisodeUrl(rawUrl);
    if (!episodeUrl) {
      return fail(c, "invalid_episode_url");
    }
    const episodeId = episodeUrl.split("/").pop()!;

    try {
      const outbound = createOutboundFetch(c.env);
      const pageResponse = await outbound(episodeUrl, { headers: browserHeaders(episodeUrl) });
      if (!pageResponse.ok) {
        return fail(c, `championcross page ${pageResponse.status}`, 502);
      }
      const html = await pageResponse.text();
      const apiOrigin = parseApiOrigin(episodeUrl, html);
      const detail = await fetchEpisodeDetail(outbound, apiOrigin, episodeId, episodeUrl);
      const viewerId = detail.viewerId ?? parsePageViewerId(html);
      if (!viewerId) {
        return fail(c, "chapter_not_free", 403);
      }

      const pages = await fetchChapterPages(outbound, apiOrigin, viewerId, episodeUrl);
      const payload: ComicPagesResponse = {
        platform: "championcross",
        episodeId,
        episodeTitle: detail.title,
        pages,
      };
      return c.json(payload);
    } catch (error) {
      return fail(c, error instanceof Error ? error.message : "pages_failed", 502);
    }
  });

  // GET /tools/comics/championcross/image?url=<image url>&referer=<episode url>&name=<file>
  app.get("/comics/championcross/image", async (c: AppContext) => {
    const target = c.req.query("url") ?? "";
    const referer = c.req.query("referer") ?? "";
    if (!isAllowedChampionCrossUrl(target)) {
      return fail(c, "invalid_image_url");
    }
    if (!normalizeEpisodeUrl(referer)) {
      return fail(c, "invalid_referer");
    }
    const fileName = sanitizeFileName(c.req.query("name"), fileNameFromUrl(target, "page.jpg"));
    return streamUpstream(createOutboundFetch(c.env), target, imageHeaders(referer), {
      fileName,
      contentTypeFallback: "image/jpeg",
    });
  });

  return app;
}
