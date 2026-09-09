import type { XMediaItem, XTweetMediaResponse } from "@rin/api";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { client } from "../../app/runtime";
import { ToolCard, ToolError, ToolField, ToolShell } from "./tool-shell";

const KIND_ICON: Record<string, string> = {
  video: "ri-video-line",
  gif: "ri-file-gif-line",
  photo: "ri-image-line",
};

function fileNameFor(tweetId: string, item: XMediaItem, index: number, variantIndex?: number): string {
  const url = variantIndex === undefined ? item.url : (item.variants[variantIndex]?.url ?? item.url);
  const extension = item.kind === "photo" ? (url.split("?")[0]?.match(/\.(\w+)$/)?.[1] ?? "jpg") : "mp4";
  const suffix = variantIndex === undefined ? "" : `_${variantIndex + 1}`;
  return `${tweetId}_${index + 1}${suffix}.${extension}`;
}

/** Maps server error codes to readable messages, falling back to the raw text. */
function friendlyError(message: string, translate: (key: string) => string): string {
  if (message.includes("invalid_tweet_url")) {
    return translate("tools.x_downloader.error_invalid_url");
  }
  if (message.includes("tweet_resolve_failed")) {
    return translate("tools.x_downloader.error_unavailable");
  }
  return message;
}

function MediaCard({
  tweetId,
  item,
  index,
}: {
  tweetId: string;
  item: XMediaItem;
  index: number;
}) {
  const { t } = useTranslation();
  const previewUrl = item.kind === "photo" ? item.url : item.thumbnailUrl;
  const fileName = fileNameFor(tweetId, item, index);

  const downloadLink = (url: string, name: string) => client.tools.xProxyUrl(url, name);

  return (
    <div className="overflow-hidden rounded-xl border border-black/10 bg-background-light/40 dark:border-white/10 dark:bg-neutral-900/40">
      <div className="relative flex h-44 items-center justify-center bg-neutral-100 dark:bg-neutral-800">
        {previewUrl ? (
          <img
            src={downloadLink(previewUrl, `preview-${index}`)}
            alt=""
            loading="lazy"
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <i className="ri-image-line text-3xl text-neutral-400" aria-hidden="true" />
        )}
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
          <i className={KIND_ICON[item.kind] ?? "ri-file-line"} aria-hidden="true" />
          {t(`tools.x_downloader.kind.${item.kind}`)}
        </span>
      </div>

      <div className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400">
          <span>{item.label ?? t("tools.x_downloader.unknown_size")}</span>
          {item.variants.length > 1 ? (
            <span>{t("tools.x_downloader.variant_count$count", { count: item.variants.length })}</span>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 rounded-full bg-theme px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-theme-hover"
          >
            <i className="ri-external-link-line" aria-hidden="true" />
            {t("tools.x_downloader.direct")}
          </a>
          <a
            href={downloadLink(item.url, fileName)}
            className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-w px-3 py-1.5 text-xs font-medium t-primary transition-colors hover:border-theme/40 dark:border-white/10"
          >
            <i className="ri-download-2-line" aria-hidden="true" />
            {t("tools.x_downloader.proxy")}
          </a>
          <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(item.url)}
            className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-w px-3 py-1.5 text-xs font-medium t-primary transition-colors hover:border-theme/40 dark:border-white/10"
          >
            <i className="ri-link" aria-hidden="true" />
            {t("tools.x_downloader.copy")}
          </button>
        </div>

        {item.variants.length > 1 ? (
          <details className="text-xs">
            <summary className="cursor-pointer select-none text-neutral-500 transition-colors hover:text-theme dark:text-neutral-400">
              {t("tools.x_downloader.variants")}
            </summary>
            <ul className="mt-2 space-y-1">
              {item.variants.map((variant, variantIndex) => (
                <li key={variant.url} className="flex items-center justify-between gap-2">
                  <span className="truncate text-neutral-500 dark:text-neutral-400">
                    {variant.bitrate ? `${Math.round(variant.bitrate / 1000)} kbps` : variant.container}
                  </span>
                  <a
                    href={downloadLink(variant.url, fileNameFor(tweetId, item, index, variantIndex))}
                    className="shrink-0 text-theme hover:underline"
                  >
                    {t("tools.x_downloader.download")}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </div>
  );
}

export function XDownloaderPage() {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<XTweetMediaResponse | null>(null);

  async function resolve() {
    const value = input.trim();
    if (!value || loading) {
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);

    const response = await client.tools.xMedia(value);
    setLoading(false);

    if (response.error) {
      setError(friendlyError(response.error.value || "", t) || t("tools.x_downloader.failed"));
      return;
    }
    setResult(response.data ?? null);
  }

  return (
    <ToolShell
      titleKey="tools.x_downloader.title"
      descriptionKey="tools.x_downloader.desc"
      icon="ri-twitter-x-line"
    >
      <div className="space-y-4">
        <ToolCard>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <ToolField
                label={t("tools.x_downloader.url_label")}
                hint={t("tools.x_downloader.url_hint")}
              >
                <input
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void resolve();
                    }
                  }}
                  placeholder="https://x.com/user/status/1234567890"
                  className="w-full rounded-xl border border-black/10 bg-w px-4 py-2 t-primary transition-colors placeholder:text-neutral-400 focus:border-black/20 focus:outline-none focus:ring-2 focus:ring-theme/10 dark:border-white/10 dark:placeholder:text-neutral-500"
                />
              </ToolField>
            </div>
            <button
              type="button"
              onClick={() => void resolve()}
              disabled={loading || !input.trim()}
              className="inline-flex h-min items-center gap-2 rounded-full bg-theme px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-theme-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <i className="ri-loader-4-line animate-spin" aria-hidden="true" />
              ) : (
                <i className="ri-search-line" aria-hidden="true" />
              )}
              {loading ? t("tools.x_downloader.resolving") : t("tools.x_downloader.resolve")}
            </button>
          </div>
        </ToolCard>

        {error ? <ToolError message={error} /> : null}

        {result ? (
          <ToolCard className="space-y-4">
            <div className="flex items-start gap-3">
              {result.authorAvatar ? (
                <img
                  src={client.tools.xProxyUrl(result.authorAvatar, "avatar.jpg")}
                  alt=""
                  className="h-11 w-11 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-theme/10 text-theme">
                  <i className="ri-user-line" aria-hidden="true" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="font-semibold t-primary">{result.authorName}</span>
                  <span className="text-sm text-neutral-500 dark:text-neutral-400">@{result.authorHandle}</span>
                  {result.createdAt ? (
                    <span className="text-xs text-neutral-400 dark:text-neutral-500">{result.createdAt}</span>
                  ) : null}
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm t-primary">{result.text}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                  <a
                    href={result.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-theme hover:underline"
                  >
                    <i className="ri-external-link-line" aria-hidden="true" />
                    {t("tools.x_downloader.open_tweet")}
                  </a>
                  <span>·</span>
                  <span>{t("tools.x_downloader.source", { source: result.source })}</span>
                </div>
              </div>
            </div>

            {result.media.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {result.media.map((item, index) => (
                  <MediaCard key={`${item.id}-${index}`} tweetId={result.tweetId} item={item} index={index} />
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-black/15 px-4 py-6 text-center text-sm text-neutral-500 dark:border-white/15 dark:text-neutral-400">
                <i className="ri-file-unknow-line mr-1" aria-hidden="true" />
                {t("tools.x_downloader.no_media")}
              </div>
            )}
          </ToolCard>
        ) : null}

        <p className="px-1 text-xs text-neutral-500 dark:text-neutral-400">
          {t("tools.x_downloader.note")}
        </p>
      </div>
    </ToolShell>
  );
}
