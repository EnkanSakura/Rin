import type { ComicChapter, ComicPage } from "@rin/api";

/**
 * Champion Cross (https://championcross.jp) reader helpers.
 *
 * Ported from the community downloader
 * https://github.com/EnkanSakura/championcross-download (download.py):
 * the page html exposes an api root (`data-api-domain`) plus a viewer id, the
 * episode api yields a per-chapter viewer id, and `/book/contentsInfo` returns
 * signed image urls whose pages are scrambled in a 4x4 block order that the
 * browser has to undo before the pages are readable.
 */

export const CHAMPIONCROSS_ORIGIN = "https://championcross.jp";
export const CHAMPIONCROSS_API_ORIGIN = `${CHAMPIONCROSS_ORIGIN}/api`;

const EPISODE_PATH_PATTERN = /\/episodes\/([A-Za-z0-9_-]+)/;
const CATALOG_PAGE_SIZE = 30;
const CATALOG_MAX_PAGES = 20;
const PAGES_WINDOW = 60;

const BROWSER_HEADERS: Record<string, string> = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

export interface ChampionCrossEpisodeDetail {
  episodeId: string;
  title: string;
  seriesId: string;
  seriesTitle: string;
  /** Per-chapter viewer token; absent when the chapter is not readable for free. */
  viewerId: string | null;
}

export interface ChampionCrossResolveResult {
  detail: ChampionCrossEpisodeDetail;
  chapters: ComicChapter[];
  apiOrigin: string;
}

/** Allowed hosts for the championcross proxy endpoints. */
const ALLOWED_HOST_SUFFIXES = ["championcross.jp", "comici.jp"];

export function isAllowedChampionCrossUrl(value: string): boolean {
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
  return ALLOWED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/** Extracts the episode id from a championcross episode page url. */
export function parseEpisodeId(input: string): string | null {
  const raw = (input ?? "").trim();
  if (!raw) {
    return null;
  }
  const match = raw.match(EPISODE_PATH_PATTERN);
  if (!match) {
    return null;
  }
  return match[1];
}

/** Normalizes a user supplied url to a canonical championcross episode page url. */
export function normalizeEpisodeUrl(input: string): string | null {
  const raw = (input ?? "").trim();
  if (!raw) {
    return null;
  }

  // A bare episode id is accepted as a convenience.
  if (/^[A-Za-z0-9_-]{6,32}$/.test(raw)) {
    return `${CHAMPIONCROSS_ORIGIN}/episodes/${raw}`;
  }

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  if (!isAllowedChampionCrossUrl(withScheme)) {
    return null;
  }

  const episodeId = parseEpisodeId(withScheme);
  if (!episodeId) {
    return null;
  }
  return `${CHAMPIONCROSS_ORIGIN}/episodes/${episodeId}`;
}

/** Resolves the api root from the page html (`data-api-domain` attribute). */
export function parseApiOrigin(pageUrl: string, html: string): string {
  const match = html.match(/data-api-domain="([^"]+)"/);
  const domain = match?.[1];
  if (!domain) {
    return CHAMPIONCROSS_API_ORIGIN;
  }
  if (domain.startsWith("/")) {
    try {
      return new URL(domain, pageUrl).toString().replace(/\/$/, "");
    } catch {
      return CHAMPIONCROSS_API_ORIGIN;
    }
  }
  if (domain.startsWith("http")) {
    return domain.replace(/\/$/, "");
  }
  return `https://${domain.replace(/\/$/, "")}`;
}

/** Extracts the page level viewer id used before the api returns one. */
export function parsePageViewerId(html: string): string | null {
  return html.match(/comici-viewer-id="([A-Za-z0-9_-]+)"/)?.[1] ?? null;
}

/**
 * Parses the per-page scramble order. The api returns it either as an array or
 * as a stringified array (the python reference uses `eval`).
 * Returns null when the value is not a valid block permutation.
 */
export function parseScramble(value: unknown): number[] | null {
  let candidate: unknown = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    try {
      candidate = JSON.parse(trimmed);
    } catch {
      try {
        candidate = JSON.parse(trimmed.replace(/'/g, '"'));
      } catch {
        return null;
      }
    }
  }
  if (!Array.isArray(candidate)) {
    return null;
  }
  const numbers = candidate.map((entry) => Number(entry));
  if (!numbers.every((entry) => Number.isInteger(entry) && entry >= 0)) {
    return null;
  }
  const sorted = [...numbers].sort((left, right) => left - right);
  for (let index = 0; index < sorted.length; index += 1) {
    if (sorted[index] !== index) {
      return null;
    }
  }
  return numbers;
}

export function browserHeaders(referer: string): Record<string, string> {
  return { ...BROWSER_HEADERS, referer };
}

export function apiHeaders(referer: string): Record<string, string> {
  return {
    ...BROWSER_HEADERS,
    accept: "application/json, text/plain, */*",
    "x-requested-with": "XMLHttpRequest",
    referer,
  };
}

export function imageHeaders(referer: string): Record<string, string> {
  return {
    ...BROWSER_HEADERS,
    accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    origin: CHAMPIONCROSS_ORIGIN,
    referer,
    "sec-fetch-dest": "image",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
  };
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  referer: string,
): Promise<Record<string, any>> {
  const response = await fetchImpl(url, { headers: apiHeaders(referer) });
  if (!response.ok) {
    throw new Error(`championcross api ${response.status} for ${url}`);
  }
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    throw new Error(`championcross api returned non-json payload for ${url}`);
  }
}

function apiUrl(apiOrigin: string, path: string, params: Record<string, string | number>): string {
  const url = new URL(`${apiOrigin}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/** GET /episodes/:id - chapter meta, series hash and the reader token. */
export async function fetchEpisodeDetail(
  fetchImpl: typeof fetch,
  apiOrigin: string,
  episodeId: string,
  referer: string,
): Promise<ChampionCrossEpisodeDetail> {
  const payload = await fetchJson(fetchImpl, apiUrl(apiOrigin, `/episodes/${episodeId}`, {}), referer);
  const episode = (payload?.episode ?? {}) as Record<string, any>;
  const content = Array.isArray(episode.content) ? episode.content : [];
  const viewerId: string | null = content[0]?.viewerId ?? null;
  const series = (episode.series ?? {}) as Record<string, any>;
  return {
    episodeId,
    title: String(episode?.summary?.title ?? episode?.title ?? episodeId),
    seriesId: String(series.id ?? ""),
    seriesTitle: String(series.name ?? ""),
    viewerId,
  };
}

/** GET /episodes + /series/access - full chapter catalog with free flags. */
export async function fetchCatalog(
  fetchImpl: typeof fetch,
  apiOrigin: string,
  seriesId: string,
  referer: string,
): Promise<ComicChapter[]> {
  const chapters: ComicChapter[] = [];
  const seen = new Set<string>();

  for (let page = 0; page < CATALOG_MAX_PAGES; page += 1) {
    const from = page * CATALOG_PAGE_SIZE + 1;
    const to = from + CATALOG_PAGE_SIZE - 1;
    const params = { seriesHash: seriesId, episodeFrom: from, episodeTo: to };
    const catalog = await fetchJson(fetchImpl, apiUrl(apiOrigin, "/episodes", params), referer);
    const episodes = (catalog?.series?.episodes ?? []) as Array<Record<string, any>>;

    let access = new Map<string, boolean>();
    try {
      const accessPayload = await fetchJson(fetchImpl, apiUrl(apiOrigin, "/series/access", params), referer);
      const list = (accessPayload?.seriesAccess?.episodeAccesses ?? []) as Array<Record<string, any>>;
      access = new Map(list.map((entry) => [String(entry.episodeId), Boolean(entry.hasAccess)]));
    } catch {
      access = new Map();
    }

    for (const episode of episodes) {
      const id = String(episode?.id ?? "");
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      chapters.push({
        id,
        title: String(episode?.title ?? id),
        free: access.get(id) ?? false,
        current: false,
      });
    }

    if (episodes.length < CATALOG_PAGE_SIZE) {
      break;
    }
  }

  return chapters;
}

/** GET /book/contentsInfo - signed page urls plus scramble orders for one chapter. */
export async function fetchChapterPages(
  fetchImpl: typeof fetch,
  apiOrigin: string,
  viewerId: string,
  referer: string,
): Promise<ComicPage[]> {
  const base = { "user-id": "0", "comici-viewer-id": viewerId };
  const first = await fetchJson(
    fetchImpl,
    apiUrl(apiOrigin, "/book/contentsInfo", { ...base, "page-from": 0, "page-to": 0 }),
    referer,
  );
  const total = Number(first?.totalPages ?? 0);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("championcross returned no pages for this chapter");
  }

  const bySort = new Map<number, ComicPage>();
  const collect = (payload: Record<string, any>) => {
    for (const raw of (payload?.result ?? []) as Array<Record<string, any>>) {
      const sort = Number(raw?.sort ?? 0);
      const url = String(raw?.imageUrl ?? "");
      if (!url) continue;
      bySort.set(sort, {
        url,
        scramble: parseScramble(raw?.scramble),
        sort,
        width: Number(raw?.width ?? 0) || undefined,
        height: Number(raw?.height ?? 0) || undefined,
      });
    }
  };

  collect(first);

  for (let from = 0; from < total; from += PAGES_WINDOW) {
    const to = Math.min(from + PAGES_WINDOW - 1, total - 1);
    if (from === 0 && bySort.size >= to + 1) {
      continue;
    }
    const payload = await fetchJson(
      fetchImpl,
      apiUrl(apiOrigin, "/book/contentsInfo", { ...base, "page-from": from, "page-to": to }),
      referer,
    );
    collect(payload);
  }

  const pages = [...bySort.values()].sort((left, right) => left.sort - right.sort);
  if (!pages.length) {
    throw new Error("championcross returned an empty page list");
  }
  return pages;
}

/** Full resolve flow used by POST /tools/comics/championcross/resolve. */
export async function resolveChampionCrossEpisode(
  fetchImpl: typeof fetch,
  episodeUrl: string,
): Promise<ChampionCrossResolveResult> {
  const normalized = normalizeEpisodeUrl(episodeUrl);
  if (!normalized) {
    throw new Error("expected a championcross episode url (https://championcross.jp/episodes/...)");
  }
  const episodeId = parseEpisodeId(normalized)!;

  const pageResponse = await fetchImpl(normalized, { headers: browserHeaders(normalized) });
  if (!pageResponse.ok) {
    throw new Error(`championcross page ${pageResponse.status}`);
  }
  const html = await pageResponse.text();
  const apiOrigin = parseApiOrigin(normalized, html);
  const pageViewerId = parsePageViewerId(html);

  const detail = await fetchEpisodeDetail(fetchImpl, apiOrigin, episodeId, normalized);
  if (!detail.viewerId && pageViewerId) {
    detail.viewerId = pageViewerId;
  }

  let chapters: ComicChapter[] = [
    { id: episodeId, title: detail.title, free: Boolean(detail.viewerId), current: true },
  ];
  if (detail.seriesId) {
    try {
      const catalog = await fetchCatalog(fetchImpl, apiOrigin, detail.seriesId, normalized);
      if (catalog.length) {
        chapters = catalog.map((chapter) => ({
          ...chapter,
          free: chapter.free || (chapter.id === episodeId && Boolean(detail.viewerId)),
          current: chapter.id === episodeId,
        }));
      }
    } catch {
      // catalog is a convenience: keep the single-chapter fallback
    }
  }

  return { detail, chapters, apiOrigin };
}
