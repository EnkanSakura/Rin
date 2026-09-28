import { useContext, useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import ReactLoading from "react-loading";
import { useSiteConfig } from "../hooks/useSiteConfig";
import { ClientConfigContext } from "../state/config";
import { bangumiCoverSource, bangumiCoverSrc, bangumiGridClass } from "../utils/bangumi";
import { useImageLoadState } from "../utils/use-image-load-state";

import type { UserSubjectCollection, UserSubjectCollectionResponse } from "@rin/api";

const SUBJECT_TYPE_LABELS: Record<number, string> = {
  1: "book",
  2: "anime",
  3: "music",
  4: "game",
  6: "reality",
};

const SUBJECT_TYPE_NAMES: Record<string, string> = {
  anime: "bangumi.category.anime",
  book: "bangumi.category.book",
  music: "bangumi.category.music",
  game: "bangumi.category.game",
  reality: "bangumi.category.reality",
};

const COLLECTION_TYPE_NAMES: Record<number, string> = {
  1: "bangumi.status.wish",
  2: "bangumi.status.done",
  3: "bangumi.status.doing",
  4: "bangumi.status.on_hold",
  5: "bangumi.status.dropped",
};

function getSubjectTypeKey(type: number): string {
  return SUBJECT_TYPE_LABELS[type] || "other";
}

async function fetchBangumiCollection(
  userId: string,
  apiUrl: string,
  userAgent: string,
  limit = 100,
  offset = 0,
): Promise<UserSubjectCollectionResponse> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  const url = `${apiUrl}/v0/users/${userId}/collections?${params}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": userAgent,
    },
  });
  if (!res.ok) {
    throw new Error(`Bangumi API error: ${res.status}`);
  }
  return res.json();
}

/** Fetch all collections with pagination support */
async function fetchAllCollections(
  userId: string,
  apiUrl: string,
  userAgent: string,
  maxLimit = 100,
): Promise<UserSubjectCollection[]> {
  const all: UserSubjectCollection[] = [];
  let offset = 0;
  let total = 0;

  do {
    const res = await fetchBangumiCollection(userId, apiUrl, userAgent, maxLimit, offset);
    all.push(...res.data);
    total = res.total;
    offset += maxLimit;
  } while (offset < total);

  return all;
}

/** Fetch the collection from the site API (used in "auto" update mode) */
async function fetchLocalCollections(): Promise<UserSubjectCollection[]> {
  const res = await fetch("/api/bangumi", {
    headers: {
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Bangumi local API error: ${res.status}`);
  }
  const body = (await res.json()) as { data?: UserSubjectCollection[] };
  return body.data ?? [];
}

/** Trigger a manual sync through the site API (used in "auto" update mode) */
async function fetchBangumiUpdate(): Promise<UserSubjectCollection[]> {
  const res = await fetch("/api/bangumi/update", {
    method: "POST",
    headers: {
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Bangumi local API error: ${res.status}`);
  }
  const body = (await res.json()) as { data?: UserSubjectCollection[] };
  return body.data ?? [];
}

function subjectTitle(item: UserSubjectCollection): string {
  return item.subject.name_cn || item.subject.name;
}

/** Deterministic gradient so an offline placeholder still looks like artwork. */
function placeholderGradient(seed: number): string {
  const hue = Math.abs(Math.round(seed) * 47) % 360;
  return `linear-gradient(150deg, hsl(${hue} 42% 34%), hsl(${(hue + 46) % 360} 38% 17%))`;
}

/**
 * Cover artwork served through the site API. When the proxy has nothing to
 * return (no network to Bangumi at all) a generated placeholder with the
 * subject title is shown instead, so the grid never collapses.
 */
function BangumiCover({ item }: { item: UserSubjectCollection }) {
  const title = subjectTitle(item);
  const src = bangumiCoverSrc(bangumiCoverSource(item.subject.images));
  const { failed, imageRef, loaded, onError, onLoad } = useImageLoadState(src);

  if (!src || failed) {
    return (
      <div
        role="img"
        aria-label={title}
        className="flex h-full w-full items-center justify-center p-2.5 text-center"
        style={{ backgroundImage: placeholderGradient(item.subject_id) }}
      >
        <span className="line-clamp-5 text-xs font-medium leading-snug text-white/85">{title}</span>
      </div>
    );
  }

  return (
    <img
      ref={imageRef}
      src={src}
      alt={title}
      loading="lazy"
      onLoad={onLoad}
      onError={onError}
      className={`h-full w-full object-cover transition duration-300 group-hover:scale-105 ${
        loaded ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}

export function BangumiPage() {
  const { t } = useTranslation();
  const siteConfig = useSiteConfig();
  const clientConfig = useContext(ClientConfigContext);

  // 追番默认启用（设置中已无“启用追番”开关），配置了用户 ID 即展示
  const bangumiUserId = String(clientConfig.get("bangumi.userId") ?? "");
  const bangumiApiUrl = String(clientConfig.get("bangumi.apiUrl") ?? "https://api.bgm.tv");
  const bangumiSubjectBaseUrl = String(
    clientConfig.get("bangumi.subjectBaseUrl") ?? "https://bgm.tv/subject/",
  );
  const bangumiUserAgent = String(clientConfig.get("bangumi.userAgent") ?? "Rin-Bangumi/1.0");
  const bangumiUpdateMode = String(clientConfig.get("bangumi.updateMode") ?? "realtime");
  const rawCategoryOrder = String(clientConfig.get("bangumi.categoryOrder") ?? "[]");
  const bangumiColumns = clientConfig.get("bangumi.columns");
  let categoryOrder: string[];
  try {
    categoryOrder = JSON.parse(rawCategoryOrder);
  } catch {
    categoryOrder = ["anime", "book", "music", "game"];
  }

  const [collections, setCollections] = useState<UserSubjectCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [activeStatus, setActiveStatus] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Manual "更新" button: pull the latest collection via the site API (auto mode)
  async function handleManualRefresh() {
    if (refreshing || loading) return;
    setRefreshing(true);
    setUpdateError(null);
    try {
      const items = await fetchBangumiUpdate();
      items.sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      );
      setCollections(items);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setUpdateError(t("bangumi.refresh_failed$message", { message }));
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (!bangumiUserId) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadAll() {
      setLoading(true);
      setError(null);
      try {
        // "auto": read the daily-synced snapshot from the site API (D1);
        // "realtime": fetch directly from the Bangumi API with pagination
        const all =
          bangumiUpdateMode === "auto"
            ? await fetchLocalCollections()
            : await fetchAllCollections(bangumiUserId, bangumiApiUrl, bangumiUserAgent);
        if (cancelled) return;

        // Sort by updated_at descending
        all.sort(
          (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        );

        setCollections(all);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadAll();

    return () => {
      cancelled = true;
    };
  }, [bangumiUserId, bangumiApiUrl, bangumiUserAgent, bangumiUpdateMode]);

  // Compute categories that actually have data
  const availableCategories = useMemo(() => {
    const keys = new Set(collections.map((c) => getSubjectTypeKey(c.subject_type)));
    return categoryOrder.filter((k) => keys.has(k));
  }, [collections, categoryOrder]);

  // Filter collections
  const filtered = useMemo(() => {
    let result = collections;
    if (activeCategory) {
      const typeKey = Object.entries(SUBJECT_TYPE_LABELS).find(
        ([, v]) => v === activeCategory,
      );
      if (typeKey) {
        result = result.filter((c) => c.subject_type === Number(typeKey[0]));
      }
    }
    if (activeStatus !== null) {
      result = result.filter((c) => c.type === activeStatus);
    }
    return result;
  }, [collections, activeCategory, activeStatus]);

  function formatScore(score: number) {
    if (score <= 0) return null;
    return score.toFixed(1);
  }

  if (!bangumiUserId) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Helmet>
          <title>{`${t("bangumi.title")} - ${siteConfig.name}`}</title>
        </Helmet>
        <p className="text-neutral-500">{t("bangumi.not_configured")}</p>
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>{`${t("bangumi.title")} - ${siteConfig.name}`}</title>
      </Helmet>
      <main className="w-full flex flex-col justify-center items-center mb-8 ani-show">
        <div className="wauto flex flex-row items-center justify-between gap-3 py-4 text-start">
          <p className="text-4xl font-bold text-black dark:text-white">
            {t("bangumi.title")}
          </p>
          {bangumiUpdateMode === "auto" && (
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={refreshing || loading}
              title={t("bangumi.refresh")}
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-black/10 bg-w px-3 py-1.5 text-sm font-medium text-neutral-600 transition-all hover:border-theme/30 hover:text-theme disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:text-neutral-300"
            >
              <i
                className={`${refreshing ? "ri-loader-4-line animate-spin" : "ri-refresh-line"} text-base`}
              />
              {t("bangumi.refresh")}
            </button>
          )}
        </div>
        {updateError && (
          <div className="wauto -mt-2 mb-2 flex items-center gap-1.5 text-sm text-red-500">
            <i className="ri-error-warning-line" />
            {updateError}
          </div>
        )}

        {/* Category Tabs */}
        <div className="wauto mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveCategory("")}
            className={`rounded-xl px-4 py-1.5 text-sm font-medium transition-all ${
              activeCategory === ""
                ? "bg-theme text-white"
                : "border border-black/10 bg-w text-neutral-600 hover:border-black/20 dark:border-white/10 dark:text-neutral-300"
            }`}
          >
            {t("bangumi.all")}
          </button>
          {availableCategories.map((cat) => {
            const labelKey = SUBJECT_TYPE_NAMES[cat];
            if (!labelKey) return null;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={`rounded-xl px-4 py-1.5 text-sm font-medium transition-all ${
                  activeCategory === cat
                    ? "bg-theme text-white"
                    : "border border-black/10 bg-w text-neutral-600 hover:border-black/20 dark:border-white/10 dark:text-neutral-300"
                }`}
              >
                {t(labelKey)}
              </button>
            );
          })}
        </div>

        {/* Status Filters */}
        <div className="wauto mb-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveStatus(null)}
            className={`rounded-lg px-3 py-1 text-xs font-medium transition-all ${
              activeStatus === null
                ? "bg-neutral-200 text-black dark:bg-white/15 dark:text-white"
                : "text-neutral-500 hover:text-black dark:hover:text-white"
            }`}
          >
            {t("bangumi.all_status")}
          </button>
          {[1, 2, 3, 4, 5].map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setActiveStatus(activeStatus === status ? null : status)}
              className={`rounded-lg px-3 py-1 text-xs font-medium transition-all ${
                activeStatus === status
                  ? "bg-neutral-200 text-black dark:bg-white/15 dark:text-white"
                  : "text-neutral-500 hover:text-black dark:hover:text-white"
              }`}
            >
              {t(COLLECTION_TYPE_NAMES[status])}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <ReactLoading width="2em" height="2em" type="spin" color="#FC466B" />
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-20">
            <p className="text-red-500">{error}</p>
          </div>
        )}

        {!loading && !error && (
          <>
            {filtered.length === 0 ? (
              <p className="py-20 text-center text-neutral-500">{t("bangumi.empty")}</p>
            ) : (
              <div className={`wauto grid gap-3 ${bangumiGridClass(bangumiColumns)}`}>
                {filtered.map((item) => (
                  <a
                    key={`${item.subject_id}-${item.type}`}
                    href={`${bangumiSubjectBaseUrl}${item.subject_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative flex flex-col overflow-hidden rounded-xl border border-black/10 bg-w transition-all hover:border-theme/30 hover:shadow-md dark:border-white/10"
                  >
                    {/* Cover Image with Overlays */}
                    <div className="relative aspect-[2/3] overflow-hidden bg-neutral-100 dark:bg-neutral-800">
                      <BangumiCover item={item} />

                      {/* Bangumi Score — top left */}
                      {item.subject.score > 0 && (
                        <div className="absolute left-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-xs font-semibold text-amber-400 backdrop-blur-sm">
                          Bgm: {formatScore(item.subject.score)}
                        </div>
                      )}

                      {/* Status — top right */}
                      <div className="absolute right-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-xs text-white/90 backdrop-blur-sm">
                        {t(COLLECTION_TYPE_NAMES[item.type])}
                      </div>

                      {/* Bottom overlays: my score badge, then the comment hint bar */}
                      <div className="absolute inset-x-0 bottom-0 flex flex-col items-end gap-1">
                        {item.rate > 0 && (
                          <div className="mr-1.5 rounded-md bg-black/60 px-2 py-0.5 text-xs font-semibold text-rose-400 backdrop-blur-sm">
                            {t("bangumi.my_score")}: {item.rate}
                          </div>
                        )}

                        {item.comment && (
                          <div className="flex w-full items-center justify-center gap-1 bg-black/60 py-1 text-[11px] font-medium text-white/90 backdrop-blur-sm">
                            <i className="ri-chat-3-line" aria-hidden="true" />
                            {t("bangumi.view_comment")}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Info — title only */}
                    <div className="flex flex-col px-2.5 pb-2.5 pt-2">
                      <h3 className="line-clamp-2 text-xs font-medium leading-snug t-primary group-hover:text-theme transition-colors">
                        {subjectTitle(item)}
                      </h3>
                    </div>

                    {/* Comment — revealed on hover, covering the whole card */}
                    {item.comment && (
                      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col gap-1.5 overflow-y-auto bg-black/85 p-3 opacity-0 backdrop-blur-sm transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-visible:opacity-100">
                        <p className="shrink-0 text-xs font-semibold leading-snug text-white">
                          {subjectTitle(item)}
                        </p>
                        <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-white/85">
                          {item.comment}
                        </p>
                      </div>
                    )}
                  </a>
                ))}
              </div>
            )}

            {/* Summary */}
            <div className="mt-6 text-center text-xs text-neutral-400">
              {t("bangumi.total_count", { count: collections.length })}
            </div>
          </>
        )}
      </main>
    </>
  );
}
