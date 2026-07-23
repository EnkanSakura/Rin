import { useContext, useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import ReactLoading from "react-loading";
import { useSiteConfig } from "../hooks/useSiteConfig";
import { ClientConfigContext } from "../state/config";

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

export function BangumiPage() {
  const { t } = useTranslation();
  const siteConfig = useSiteConfig();
  const clientConfig = useContext(ClientConfigContext);

  const bangumiEnabled = clientConfig.getBoolean("bangumi.enabled");
  const bangumiUserId = String(clientConfig.get("bangumi.userId") ?? "");
  const bangumiApiUrl = String(clientConfig.get("bangumi.apiUrl") ?? "https://api.bgm.tv");
  const bangumiSubjectBaseUrl = String(
    clientConfig.get("bangumi.subjectBaseUrl") ?? "https://bgm.tv/subject/",
  );
  const bangumiUserAgent = String(clientConfig.get("bangumi.userAgent") ?? "Rin-Bangumi/1.0");
  const rawCategoryOrder = String(clientConfig.get("bangumi.categoryOrder") ?? "[]");
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

  useEffect(() => {
    if (!bangumiEnabled || !bangumiUserId) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadAll() {
      setLoading(true);
      setError(null);
      try {
        // Fetch all collections in a single request with pagination
        const all = await fetchAllCollections(bangumiUserId, bangumiApiUrl, bangumiUserAgent);
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
  }, [bangumiEnabled, bangumiUserId, bangumiApiUrl, bangumiUserAgent]);

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

  if (!bangumiEnabled || !bangumiUserId) {
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
        <div className="wauto text-start py-4 text-4xl font-bold">
          <p className="text-black dark:text-white">
            {t("bangumi.title")}
          </p>
          <div className="flex flex-row justify-between">
          </div>
        </div>

        {/* Category Tabs */}
        <div className="wauto mb-4 flex flex-wrap gap-2">
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
              <div className="wauto grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filtered.map((item) => (
                  <a
                    key={`${item.subject_id}-${item.type}`}
                    href={`${bangumiSubjectBaseUrl}${item.subject_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex flex-col overflow-hidden rounded-xl border border-black/10 bg-w transition-all hover:border-theme/30 hover:shadow-md dark:border-white/10"
                  >
                    {/* Cover Image with Overlays */}
                    <div className="relative aspect-[2/3] overflow-hidden bg-neutral-100 dark:bg-neutral-800">
                      {item.subject.images?.medium ? (
                        <img
                          src={item.subject.images.medium}
                          alt={item.subject.name_cn || item.subject.name}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-neutral-400">
                          <i className="ri-image-line ri-2x" />
                        </div>
                      )}

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

                      {/* Bottom content — rating + comment in same container */}
                      <div className="absolute bottom-0 left-0 right-0 flex flex-col bg-gradient-to-t from-black/60 to-transparent pt-6 pointer-events-none">
                        {/* My Score */}
                        {item.rate > 0 && (
                          <div className="pointer-events-auto self-end mx-2 mb-0.5 rounded-md bg-black/60 px-2 py-0.5 text-xs font-semibold text-rose-400 backdrop-blur-sm">
                            {t("bangumi.my_score")}: {item.rate}
                          </div>
                        )}

                        {/* Comment wrapper */}
                        {item.comment && (
                          <div className="pointer-events-auto relative">
                            {/* Background layer */}
                            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
                            {/* Text */}
                            <p className="relative px-2 py-1 text-xs leading-snug text-white/90 line-clamp-3">
                              {item.comment}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Info — title only */}
                    <div className="flex flex-col px-2.5 pb-2.5 pt-2">
                      <h3 className="line-clamp-2 text-xs font-medium leading-snug t-primary group-hover:text-theme transition-colors">
                        {item.subject.name_cn || item.subject.name}
                      </h3>
                    </div>
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
