import type { ComicChapter, ComicPlatform, ComicResolveResponse } from "@rin/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { client } from "../../app/runtime";
import { unscramblePage } from "../../utils/image-unscramble";
import { buildZip, downloadBlob, sanitizeFileName, type ZipEntry } from "../../utils/zip";
import { ToolCard, ToolError, ToolField, ToolShell } from "./tool-shell";

const IMAGE_CONCURRENCY = 4;
const MAX_PAGES_PER_REQUEST = 500;

type Phase = "idle" | "resolving" | "downloading" | "done";

interface Progress {
  chapterIndex: number;
  chapterCount: number;
  chapterTitle: string;
  pageDone: number;
  pageTotal: number;
  failed: number;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function episodeUrlOf(episodeId: string): string {
  // Champion Cross episode pages are the referer the reader api expects; other
  // platforms need their own builder once they are implemented.
  return `https://championcross.jp/episodes/${episodeId}`;
}

type ErrorKind = "invalid" | "not_free" | "upstream" | "other";

/** Maps server error codes to readable messages, falling back to the raw text. */
function friendlyError(message: string, translate: (key: string) => string): { message: string; kind: ErrorKind } {
  if (message.includes("invalid_episode_url")) {
    return { message: translate("tools.comic_downloader.error_invalid_url"), kind: "invalid" };
  }
  if (message.includes("chapter_not_free")) {
    return { message: translate("tools.comic_downloader.error_not_free"), kind: "not_free" };
  }
  if (/championcross (page|api) \d+/i.test(message)) {
    return { message: translate("tools.comic_downloader.error_upstream"), kind: "upstream" };
  }
  return { message, kind: "other" };
}

export function ComicDownloaderPage() {
  const { t } = useTranslation();
  const [platforms, setPlatforms] = useState<ComicPlatform[]>([]);
  const [platform, setPlatform] = useState("championcross");
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null);
  const [resolved, setResolved] = useState<ComicResolveResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<Progress | null>(null);
  const [resultMessage, setResultMessage] = useState("");
  const [combineZip, setCombineZip] = useState(true);
  const cancelled = useRef(false);

  useEffect(() => {
    let active = true;
    void client.tools.comicPlatforms().then((response) => {
      if (!active || response.error || !response.data) {
        return;
      }
      setPlatforms(response.data.platforms);
      const firstEnabled = response.data.platforms.find((entry) => entry.enabled);
      if (firstEnabled) {
        setPlatform(firstEnabled.id);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const activePlatform = useMemo(
    () => platforms.find((entry) => entry.id === platform) ?? null,
    [platforms, platform],
  );

  const freeChapters = useMemo(
    () => (resolved?.chapters ?? []).filter((chapter) => chapter.free),
    [resolved],
  );

  const resolve = useCallback(async () => {
    const value = url.trim();
    if (!value || phase === "resolving" || phase === "downloading") {
      return;
    }
    setPhase("resolving");
    setError("");
    setErrorKind(null);
    setResolved(null);
    setResultMessage("");

    const response = await client.tools.comicResolve(platform, value);
    if (response.error) {
      const mapped = friendlyError(response.error.value || "", t);
      setPhase("idle");
      setError(mapped.message);
      setErrorKind(mapped.kind);
      return;
    }

    const data = response.data ?? null;
    setResolved(data);
    setPhase("idle");
    if (data) {
      const preset = data.chapters.filter((chapter) => chapter.free && chapter.current);
      setSelected(new Set(preset.map((chapter) => chapter.id)));
    }
  }, [platform, url, phase, t]);

  const toggleChapter = useCallback((chapter: ComicChapter) => {
    if (!chapter.free) {
      return;
    }
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(chapter.id)) {
        next.delete(chapter.id);
      } else {
        next.add(chapter.id);
      }
      return next;
    });
  }, []);

  const applyPreset = useCallback(
    (preset: "current" | "around" | "all" | "none") => {
      if (!resolved) {
        return;
      }
      if (preset === "none") {
        setSelected(new Set());
        return;
      }
      if (preset === "all") {
        setSelected(new Set(freeChapters.map((chapter) => chapter.id)));
        return;
      }
      if (preset === "current") {
        setSelected(new Set(resolved.chapters.filter((chapter) => chapter.current).map((chapter) => chapter.id)));
        return;
      }
      const index = resolved.chapters.findIndex((chapter) => chapter.current);
      const from = Math.max(0, index - 5);
      const to = index === -1 ? 0 : index + 6;
      setSelected(
        new Set(resolved.chapters.slice(from, to).filter((chapter) => chapter.free).map((chapter) => chapter.id)),
      );
    },
    [resolved, freeChapters],
  );

  const runDownload = useCallback(
    async (targets: ComicChapter[]) => {
      if (!resolved || !targets.length) {
        return;
      }
      cancelled.current = false;
      setPhase("downloading");
      setError("");
      setResultMessage("");

      const seriesFolder = sanitizeFileName(resolved.seriesTitle || "comic");
      const combined: ZipEntry[] = [];
      const perChapter: Array<{ name: string; entries: ZipEntry[] }> = [];
      let failedPages = 0;

      for (let index = 0; index < targets.length; index += 1) {
        const chapter = targets[index]!;
        setProgress({
          chapterIndex: index + 1,
          chapterCount: targets.length,
          chapterTitle: chapter.title,
          pageDone: 0,
          pageTotal: 0,
          failed: failedPages,
        });

        const pagesResponse = await client.tools.comicPages(platform, episodeUrlOf(chapter.id));
        if (pagesResponse.error || !pagesResponse.data) {
          failedPages += 1;
          continue;
        }

        const pages = pagesResponse.data.pages.slice(0, MAX_PAGES_PER_REQUEST);
        const chapterFolder = `${seriesFolder}/${sanitizeFileName(chapter.title, chapter.id)}`;
        const padding = String(pages.length).length;
        let done = 0;

        const loaded = await mapWithConcurrency(pages, IMAGE_CONCURRENCY, async (page): Promise<ZipEntry | null> => {
          try {
            const response = await fetch(
              client.tools.comicImageUrl(platform, page.url, episodeUrlOf(chapter.id), `p${page.sort}.jpg`),
            );
            if (!response.ok) {
              return null;
            }
            const scrambled = await response.blob();
            const { blob, extension } = await unscramblePage(scrambled, page.scramble);
            const data = new Uint8Array(await blob.arrayBuffer());
            done += 1;
            setProgress({
              chapterIndex: index + 1,
              chapterCount: targets.length,
              chapterTitle: chapter.title,
              pageDone: done,
              pageTotal: pages.length,
              failed: failedPages,
            });
            return {
              name: `${chapterFolder}/image_${String(page.sort + 1).padStart(padding, "0")}.${extension}`,
              data,
            };
          } catch {
            return null;
          }
        });

        const entries = loaded.filter((entry): entry is ZipEntry => entry !== null);
        failedPages += loaded.length - entries.length;

        if (combineZip) {
          combined.push(...entries);
        } else if (entries.length) {
          perChapter.push({ name: chapterFolder, entries });
        }
      }

      if (cancelled.current) {
        setPhase("idle");
        setProgress(null);
        return;
      }

      if (combineZip) {
        if (!combined.length) {
          setPhase("idle");
          setProgress(null);
          setError(t("tools.comic_downloader.nothing_downloaded"));
          return;
        }
        downloadBlob(buildZip(combined), `${seriesFolder}.zip`);
      } else {
        if (!perChapter.length) {
          setPhase("idle");
          setProgress(null);
          setError(t("tools.comic_downloader.nothing_downloaded"));
          return;
        }
        for (const chapter of perChapter) {
          downloadBlob(buildZip(chapter.entries), `${sanitizeFileName(chapter.name)}.zip`);
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }

      setPhase("done");
      setProgress(null);
      setResultMessage(
        t("tools.comic_downloader.done$chapters$failed", {
          chapters: targets.length,
          failed: failedPages,
        }),
      );
    },
    [resolved, platform, combineZip, t],
  );

  const selectedChapters = useMemo(
    () => (resolved?.chapters ?? []).filter((chapter) => selected.has(chapter.id)),
    [resolved, selected],
  );

  const busy = phase === "resolving" || phase === "downloading";

  return (
    <ToolShell
      titleKey="tools.comic_downloader.title"
      descriptionKey="tools.comic_downloader.desc"
      icon="ri-book-2-line"
    >
      <div className="space-y-4">
        <ToolCard className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,220px)_1fr]">
            <ToolField label={t("tools.comic_downloader.platform")} hint={activePlatform?.homepage}>
              <select
                value={platform}
                onChange={(event) => setPlatform(event.target.value)}
                disabled={busy}
                className="w-full rounded-xl border border-black/10 bg-w px-3 py-2 t-primary focus:outline-none focus:ring-2 focus:ring-theme/10 disabled:opacity-60 dark:border-white/10"
              >
                {platforms.map((entry) => (
                  <option key={entry.id} value={entry.id} disabled={!entry.enabled}>
                    {entry.enabled ? entry.name : `${entry.name} · ${t("tools.comic_downloader.coming_soon")}`}
                  </option>
                ))}
              </select>
            </ToolField>

            <ToolField
              label={t("tools.comic_downloader.url_label")}
              hint={t("tools.comic_downloader.url_hint")}
            >
              <div className="flex gap-2">
                <input
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void resolve();
                    }
                  }}
                  placeholder="https://championcross.jp/episodes/xxxxxxxxxxx"
                  className="min-w-0 flex-1 rounded-xl border border-black/10 bg-w px-4 py-2 t-primary transition-colors placeholder:text-neutral-400 focus:border-black/20 focus:outline-none focus:ring-2 focus:ring-theme/10 dark:border-white/10 dark:placeholder:text-neutral-500"
                />
                <button
                  type="button"
                  onClick={() => void resolve()}
                  disabled={busy || !url.trim()}
                  className="inline-flex shrink-0 items-center gap-2 rounded-full bg-theme px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-theme-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {phase === "resolving" ? (
                    <i className="ri-loader-4-line animate-spin" aria-hidden="true" />
                  ) : (
                    <i className="ri-search-line" aria-hidden="true" />
                  )}
                  {phase === "resolving" ? t("tools.comic_downloader.resolving") : t("tools.comic_downloader.resolve")}
                </button>
              </div>
            </ToolField>
          </div>
        </ToolCard>

        {error ? <ToolError message={error} /> : null}

        {errorKind === "upstream" ? (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
            <i className="ri-information-line mt-0.5 shrink-0" aria-hidden="true" />
            <span>{t("tools.comic_downloader.proxy_hint")}</span>
          </div>
        ) : null}

        {resolved ? (
          <ToolCard className="space-y-4">
            <div>
              <h2 className="text-base font-semibold t-primary">
                {resolved.seriesTitle || resolved.episodeTitle}
              </h2>
              <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
                {t("tools.comic_downloader.current_episode", { title: resolved.episodeTitle })}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["current", "preset_current"],
                  ["around", "preset_around"],
                  ["all", "preset_all"],
                  ["none", "preset_none"],
                ] as const
              ).map(([preset, labelKey]) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  disabled={busy}
                  className="rounded-full border border-black/10 bg-w px-3 py-1.5 text-xs font-medium t-primary transition-colors hover:border-theme/40 disabled:opacity-50 dark:border-white/10"
                >
                  {t(`tools.comic_downloader.${labelKey}`)}
                </button>
              ))}
              <span className="ml-auto self-center text-xs text-neutral-500 dark:text-neutral-400">
                {t("tools.comic_downloader.selected$count$total", {
                  count: selectedChapters.length,
                  total: resolved.chapters.length,
                })}
              </span>
            </div>

            <ul className="max-h-80 divide-y divide-black/5 overflow-y-auto rounded-xl border border-black/10 dark:divide-white/5 dark:border-white/10">
              {resolved.chapters.map((chapter) => (
                <li key={chapter.id}>
                  <label
                    className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm transition-colors ${
                      chapter.free ? "hover:bg-theme/5" : "cursor-not-allowed opacity-60"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(chapter.id)}
                      disabled={!chapter.free || busy}
                      onChange={() => toggleChapter(chapter)}
                      className="h-4 w-4 shrink-0 accent-theme"
                    />
                    <span className="min-w-0 flex-1 truncate t-primary">{chapter.title}</span>
                    {chapter.current ? (
                      <span className="shrink-0 rounded-full bg-theme/10 px-2 py-0.5 text-xs font-medium text-theme">
                        {t("tools.comic_downloader.current")}
                      </span>
                    ) : null}
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                        chapter.free
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "bg-neutral-500/10 text-neutral-500 dark:text-neutral-400"
                      }`}
                    >
                      {chapter.free ? t("tools.comic_downloader.free") : t("tools.comic_downloader.locked")}
                    </span>
                  </label>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-sm t-primary">
                <input
                  type="checkbox"
                  checked={combineZip}
                  disabled={busy}
                  onChange={(event) => setCombineZip(event.target.checked)}
                  className="h-4 w-4 accent-theme"
                />
                {t("tools.comic_downloader.combine")}
              </label>

              <button
                type="button"
                onClick={() => void runDownload(selectedChapters)}
                disabled={busy || !selectedChapters.length}
                className="inline-flex items-center gap-2 rounded-full bg-theme px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-theme-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {phase === "downloading" ? (
                  <i className="ri-loader-4-line animate-spin" aria-hidden="true" />
                ) : (
                  <i className="ri-download-2-line" aria-hidden="true" />
                )}
                {t("tools.comic_downloader.download$count", { count: selectedChapters.length })}
              </button>

              {phase === "downloading" ? (
                <button
                  type="button"
                  onClick={() => {
                    cancelled.current = true;
                  }}
                  className="rounded-full border border-black/10 bg-w px-4 py-2 text-sm t-primary transition-colors hover:border-red-500/40 dark:border-white/10"
                >
                  {t("tools.comic_downloader.cancel")}
                </button>
              ) : null}
            </div>

            {progress ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
                  <span className="truncate">
                    {t("tools.comic_downloader.progress$current$total$title", {
                      current: progress.chapterIndex,
                      total: progress.chapterCount,
                      title: progress.chapterTitle,
                    })}
                  </span>
                  <span className="shrink-0 pl-2">
                    {progress.pageTotal
                      ? t("tools.comic_downloader.progress_pages$done$total", {
                          done: progress.pageDone,
                          total: progress.pageTotal,
                        })
                      : t("tools.comic_downloader.progress_fetching")}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                  <div
                    className="h-full rounded-full bg-theme transition-all"
                    style={{
                      width: `${progress.pageTotal ? Math.round((progress.pageDone / progress.pageTotal) * 100) : 8}%`,
                    }}
                  />
                </div>
              </div>
            ) : null}

            {resultMessage ? (
              <div className="flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
                <i className="ri-checkbox-circle-line mt-0.5 shrink-0" aria-hidden="true" />
                <span>{resultMessage}</span>
              </div>
            ) : null}
          </ToolCard>
        ) : null}

        <p className="px-1 text-xs text-neutral-500 dark:text-neutral-400">
          {t("tools.comic_downloader.note")}
        </p>
      </div>
    </ToolShell>
  );
}
