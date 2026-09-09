import type { XMediaItem, XMediaKind, XMediaVariant, XTweetMediaResponse } from "@rin/api";

/**
 * Helpers for the X (Twitter) media downloader.
 *
 * The heavy lifting is done by the public FxTwitter API (`api.fxtwitter.com`),
 * which returns direct `video.twimg.com` / `pbs.twimg.com` urls. Everything in
 * this module is pure so it can be unit tested without network access; the
 * service layer only performs the actual fetch calls.
 */

const TWEET_ID_PATTERN = /^\d{1,25}$/;
const STATUS_PATH_PATTERN = /(?:^|\/)(?:status|statuses|web\/status)\/(\d{5,25})/i;

/** Hosts whose urls we are willing to proxy back to the browser. */
const MEDIA_HOST_SUFFIXES = [".twimg.com"];

export function isAllowedTwitterMediaUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return MEDIA_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * Accepts a raw tweet id or any X/Twitter post url and returns the numeric id.
 * Returns null when no id can be extracted.
 */
export function parseTweetId(input: string): string | null {
  const raw = (input ?? "").trim();
  if (!raw) {
    return null;
  }

  if (TWEET_ID_PATTERN.test(raw)) {
    return raw;
  }

  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    const match = url.pathname.match(STATUS_PATH_PATTERN);
    if (match) {
      return match[1];
    }
  } catch {
    // fall through to the regex below
  }

  const match = raw.match(STATUS_PATH_PATTERN);
  return match ? match[1] : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function kindOf(value: unknown, fallback: XMediaKind): XMediaKind {
  return value === "video" || value === "gif" || value === "photo" ? value : fallback;
}

function formatLabel(width?: number, height?: number, durationSeconds?: number): string | undefined {
  const parts: string[] = [];
  if (width && height) {
    parts.push(`${width}x${height}`);
  }
  if (durationSeconds && durationSeconds > 0) {
    const total = Math.round(durationSeconds);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    parts.push(minutes > 0 ? `${minutes}:${String(seconds).padStart(2, "0")}` : `${seconds}s`);
  }
  return parts.length ? parts.join(" · ") : undefined;
}

function originalPhotoUrl(url: string): string {
  if (url.includes("?")) {
    return url;
  }
  return `${url}?name=orig`;
}

/** Collect progressive mp4 variants, highest bitrate first, deduplicated. */
function collectVariants(entry: Record<string, unknown>, mainUrl?: string): XMediaVariant[] {
  const variants: XMediaVariant[] = [];
  const seen = new Set<string>();

  const push = (url: unknown, container: unknown, bitrate: unknown) => {
    const href = asString(url);
    if (!href || seen.has(href)) {
      return;
    }
    seen.add(href);
    const rate = asNumber(bitrate);
    variants.push({
      url: href,
      container: asString(container) ?? "mp4",
      bitrate: rate,
    });
  };

  const formats = asArray(entry.formats ?? entry.variants);
  for (const raw of formats) {
    const format = asRecord(raw);
    if (!format) continue;
    const container = asString(format.container) ?? asString(format.content_type) ?? "";
    if (container && !/mp4/i.test(container)) {
      continue;
    }
    push(format.url, container || "mp4", format.bitrate);
  }

  variants.sort((left, right) => (right.bitrate ?? 0) - (left.bitrate ?? 0));

  // The status payload's own url is the highest quality progressive mp4; keep
  // it first so the default download is the best available rendition.
  if (mainUrl && /\.mp4(\?|$)/i.test(mainUrl)) {
    return [{ url: mainUrl, container: "mp4" }, ...variants.filter((variant) => variant.url !== mainUrl)];
  }

  return variants;
}

function buildItem(entry: Record<string, unknown>, fallbackKind: XMediaKind, index: number): XMediaItem | null {
  const kind = kindOf(entry.type, fallbackKind);
  const rawUrl = asString(entry.url) ?? asString(entry.media_url_https) ?? asString(entry.media_url);
  if (!rawUrl) {
    return null;
  }

  const width = asNumber(entry.width);
  const height = asNumber(entry.height);
  const durationSeconds = asNumber(entry.duration) ?? asNumber(entry.duration_seconds);
  const url = kind === "photo" ? originalPhotoUrl(rawUrl) : rawUrl;
  const variants = kind === "photo" ? [] : collectVariants(entry, url);

  return {
    id: asString(entry.id) ?? asString(entry.id_str) ?? `${kind}-${index}`,
    kind,
    url,
    thumbnailUrl: asString(entry.thumbnail_url) ?? asString(entry.thumbnail),
    width,
    height,
    durationSeconds,
    label: formatLabel(width, height, durationSeconds),
    variants,
  };
}

function mediaEntries(media: Record<string, unknown>): Array<[Record<string, unknown>, XMediaKind]> {
  const entries: Array<[Record<string, unknown>, XMediaKind]> = [];
  const all = asArray(media.all);
  if (all.length) {
    for (const raw of all) {
      const entry = asRecord(raw);
      if (entry) entries.push([entry, kindOf(entry.type, "photo")]);
    }
    return entries;
  }

  for (const raw of asArray(media.videos)) {
    const entry = asRecord(raw);
    if (entry) entries.push([entry, kindOf(entry.type, "video")]);
  }
  for (const raw of asArray(media.photos)) {
    const entry = asRecord(raw);
    if (entry) entries.push([entry, "photo"]);
  }
  return entries;
}

function authorOf(source: Record<string, unknown>) {
  const author = asRecord(source.author) ?? {};
  return {
    authorName: asString(author.name) ?? asString(author.screen_name) ?? "",
    authorHandle: asString(author.screen_name) ?? "",
    authorAvatar: asString(author.avatar_url),
  };
}

function mediaOf(status: Record<string, unknown>): XMediaItem[] {
  const media = asRecord(status.media);
  if (!media) {
    return [];
  }

  const items: XMediaItem[] = [];
  for (const [entry, fallbackKind] of mediaEntries(media)) {
    const item = buildItem(entry, fallbackKind, items.length);
    if (item) {
      items.push(item);
    }
  }

  const external = asRecord(media.external);
  if (external && asString(external.url)) {
    const item = buildItem({ ...external, id: "external", type: "video" }, "video", items.length);
    if (item) {
      items.push(item);
    }
  }

  return items;
}

/**
 * Normalizes an `api.fxtwitter.com/2/status/:id` response.
 * Returns null when the payload does not describe a status.
 */
export function normalizeFxTwitterV2(payload: unknown): XTweetMediaResponse | null {
  const root = asRecord(payload);
  const status = asRecord(root?.status);
  if (!root || !status) {
    return null;
  }

  const id = asString(status.id);
  if (!id) {
    return null;
  }

  return {
    tweetId: id,
    url: asString(status.url) ?? `https://x.com/i/status/${id}`,
    ...authorOf(status),
    text: asString(status.text) ?? "",
    createdAt: asString(status.created_at),
    source: "fxtwitter",
    media: mediaOf(status),
  };
}

/**
 * Normalizes a legacy `api.fxtwitter.com/:handle/status/:id` response
 * (`{ code, tweet: {...} }`).
 */
export function normalizeFxTwitterV1(payload: unknown, fallbackId?: string): XTweetMediaResponse | null {
  const root = asRecord(payload);
  const tweet = asRecord(root?.tweet);
  if (!root || !tweet) {
    return null;
  }

  const id = asString(tweet.id) ?? fallbackId;
  if (!id) {
    return null;
  }

  return {
    tweetId: id,
    url: asString(tweet.url) ?? `https://x.com/i/status/${id}`,
    ...authorOf(tweet),
    text: asString(tweet.text) ?? "",
    createdAt: asString(tweet.created_at),
    source: "fxtwitter",
    media: mediaOf(tweet),
  };
}

/** Normalizes an `api.vxtwitter.com/Twitter/status/:id` response. */
export function normalizeVxTwitter(payload: unknown, fallbackId?: string): XTweetMediaResponse | null {
  const root = asRecord(payload);
  if (!root) {
    return null;
  }

  const url = asString(root.tweetURL) ?? "";
  const id = url.match(STATUS_PATH_PATTERN)?.[1] ?? fallbackId;
  if (!id) {
    return null;
  }

  const media: XMediaItem[] = [];
  const extended = asArray(root.media_extended);
  for (const raw of extended) {
    const entry = asRecord(raw);
    if (!entry) continue;
    const size = asRecord(entry.size) ?? {};
    const item = buildItem(
      {
        ...entry,
        width: asNumber(entry.width) ?? asNumber(size.width),
        height: asNumber(entry.height) ?? asNumber(size.height),
      },
      kindOf(entry.type, "photo"),
      media.length,
    );
    if (item) {
      media.push(item);
    }
  }

  if (!media.length) {
    for (const raw of asArray(root.mediaURLs)) {
      const href = asString(raw);
      if (!href) continue;
      const item = buildItem({ url: href, type: "photo" }, "photo", media.length);
      if (item) {
        media.push(item);
      }
    }
  }

  return {
    tweetId: id,
    url: url || `https://x.com/i/status/${id}`,
    authorName: asString(root.user_name) ?? "",
    authorHandle: asString(root.user_screen_name) ?? "",
    text: asString(root.text) ?? "",
    createdAt: asString(root.date),
    source: "vxtwitter",
    media,
  };
}
