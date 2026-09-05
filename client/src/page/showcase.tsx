import { Modal } from "@rin/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import { client } from "../app/runtime";
import { ImageWithFallback } from "../components/image-with-fallback";
import { Waiting } from "../components/loading";
import { useSiteConfig } from "../hooks/useSiteConfig";
import { siteName } from "../utils/constants";
import { filterShowcaseItems, parseShowcaseData, showcaseCoverOf } from "../utils/showcase";
import type { ShowcaseGroupWithItems, ShowcaseItem } from "@rin/api";

// ============================================================================
// Carousel (used inside the item detail dialog)
// ============================================================================

export function ShowcaseCarousel({
  images,
  alt,
  index,
  onIndexChange,
}: {
  images: string[];
  alt: string;
  index: number;
  onIndexChange: (index: number) => void;
}) {
  const { t } = useTranslation();
  const count = images.length;
  const startX = useRef<number | null>(null);

  const go = useCallback(
    (delta: number) => {
      if (count <= 1) return;
      onIndexChange((index + delta + count) % count);
    },
    [count, index, onIndexChange],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [go]);

  if (count === 0) {
    return (
      <div className="flex h-64 w-full flex-col items-center justify-center gap-2 bg-neutral-100 text-neutral-400 dark:bg-neutral-900 dark:text-neutral-600">
        <i className="ri-image-line text-4xl" aria-hidden="true" />
        <span className="text-sm">{t("showcase.no_images")}</span>
      </div>
    );
  }

  const url = images[index] ?? images[0] ?? "";

  return (
    <div
      className="relative flex h-[54vh] min-h-64 w-full select-none items-center justify-center overflow-hidden bg-neutral-950"
      onPointerDown={(event) => {
        if (count > 1) startX.current = event.clientX;
      }}
      onPointerUp={(event) => {
        if (startX.current === null) return;
        const delta = event.clientX - startX.current;
        startX.current = null;
        if (Math.abs(delta) > 48) go(delta < 0 ? 1 : -1);
      }}
    >
      <img
        key={url}
        src={url}
        alt={`${alt} ${index + 1}/${count}`}
        draggable={false}
        className="max-h-full max-w-full object-contain"
      />

      {/* Image counter */}
      {count > 1 ? (
        <span className="absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium text-white/90 backdrop-blur-sm">
          {index + 1} / {count}
        </span>
      ) : null}

      {/* Prev / Next */}
      {count > 1 ? (
        <>
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label={t("showcase.previous_image")}
            className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/70"
          >
            <i className="ri-arrow-left-s-line text-xl" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label={t("showcase.next_image")}
            className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/70"
          >
            <i className="ri-arrow-right-s-line text-xl" aria-hidden="true" />
          </button>
        </>
      ) : null}

      {/* Dots */}
      {count > 1 ? (
        <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5">
          {images.map((imageUrl, dotIndex) => (
            <button
              key={`${imageUrl}-${dotIndex}`}
              type="button"
              aria-label={t("showcase.goto_image$index", { index: dotIndex + 1 })}
              onClick={() => onIndexChange(dotIndex)}
              className={`h-1.5 rounded-full transition-all ${
                dotIndex === index ? "w-5 bg-white" : "w-1.5 bg-white/45 hover:bg-white/75"
              }`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ============================================================================
// Showcase page (public, album-like)
// ============================================================================

export function ShowcasePage() {
  const { t } = useTranslation();
  const siteConfig = useSiteConfig();

  const [groups, setGroups] = useState<ShowcaseGroupWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null);
  const [openItem, setOpenItem] = useState<ShowcaseItem | null>(null);
  const [carouselIndex, setCarouselIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    client.showcase
      .list()
      .then(({ data, error: loadError }) => {
        if (cancelled) return;
        if (loadError) {
          setError(loadError.value);
          return;
        }
        const parsed = parseShowcaseData(data);
        setGroups(parsed);
        setActiveGroupId((current) => {
          if (current !== null && parsed.some((group) => group.id === current)) return current;
          return parsed[0]?.id ?? null;
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeGroup = useMemo(() => {
    const group = groups.find((candidate) => candidate.id === activeGroupId);
    return group ?? groups[0] ?? null;
  }, [groups, activeGroupId]);

  const items = useMemo(
    () => filterShowcaseItems(activeGroup?.items),
    [activeGroup],
  );

  const totalItems = useMemo(
    () => groups.reduce((sum, group) => sum + filterShowcaseItems(group.items).length, 0),
    [groups],
  );

  function openDetail(item: ShowcaseItem) {
    setCarouselIndex(0);
    setOpenItem(item);
  }

  return (
    <>
      <Helmet>
        <title>{`${t("showcase.title")} - ${siteConfig.name}`}</title>
        <meta property="og:site_name" content={siteName} />
        <meta property="og:title" content={t("showcase.title")} />
        <meta property="og:image" content={siteConfig.avatar} />
        <meta property="og:type" content="article" />
        <meta property="og:url" content={document.URL} />
      </Helmet>

      <Waiting for={!loading}>
        <main className="w-full flex flex-col justify-center items-center mb-8 ani-show">
          <div className="wauto text-start py-4 text-4xl font-bold">
            <p className="text-black dark:text-white">{t("showcase.title")}</p>
          </div>

          {error ? (
            <p className="py-16 text-center text-neutral-500">{t("showcase.load_failed")}</p>
          ) : groups.length === 0 ? (
            <p className="py-16 text-center text-neutral-500">{t("showcase.empty")}</p>
          ) : (
            <>
              {/* Showcase tabs */}
              <div className="wauto mb-6 flex flex-wrap gap-2">
                {groups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => {
                      setActiveGroupId(group.id);
                      setOpenItem(null);
                    }}
                    className={`rounded-xl px-4 py-1.5 text-sm font-medium transition-all ${
                      activeGroup?.id === group.id
                        ? "bg-theme text-white"
                        : "border border-black/10 bg-w text-neutral-600 hover:border-black/20 dark:border-white/10 dark:text-neutral-300"
                    }`}
                  >
                    {group.name}
                  </button>
                ))}
              </div>

              {/* Item grid */}
              {items.length === 0 ? (
                <p className="py-16 text-center text-neutral-500">{t("showcase.group_empty")}</p>
              ) : (
                <div className="wauto grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                  {items.map((item) => {
                    const cover = showcaseCoverOf(item);
                    const imageCount = (item.images ?? []).length;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => openDetail(item)}
                        aria-label={t("showcase.open_detail$title", { title: item.title || t("showcase.untitled") })}
                        className="group relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-black/10 bg-w text-left transition-all hover:-translate-y-0.5 hover:border-theme/30 hover:shadow-md dark:border-white/10"
                      >
                        <div className="relative aspect-[4/3] overflow-hidden bg-neutral-100 dark:bg-neutral-800">
                          <ImageWithFallback
                            src={cover}
                            alt={item.title || t("showcase.untitled")}
                            className="h-full w-full"
                            imageClassName="transition-transform duration-300 group-hover:scale-105"
                          />
                          {imageCount > 1 ? (
                            <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-xs text-white/90 backdrop-blur-sm">
                              <i className="ri-image-line text-[0.9em]" aria-hidden="true" />
                              {imageCount}
                            </span>
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1 px-2.5 pb-2.5 pt-2">
                          <h3 className="line-clamp-1 text-sm font-medium t-primary transition-colors group-hover:text-theme">
                            {item.title || t("showcase.untitled")}
                          </h3>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="mt-8 text-center text-xs text-neutral-400">
                {t("showcase.summary$groups$items", { groups: groups.length, items: totalItems })}
              </div>
            </>
          )}
        </main>
      </Waiting>

      {/* Item detail dialog: carousel + description */}
      <Modal
        isOpen={openItem !== null}
        onRequestClose={() => setOpenItem(null)}
        contentLabel={openItem?.title || t("showcase.detail")}
        size="lg"
        panelClassName="p-0"
      >
        {openItem ? (
          <ShowcaseDetailContent
            key={openItem.id}
            item={openItem}
            carouselIndex={carouselIndex}
            onCarouselIndexChange={setCarouselIndex}
            onClose={() => setOpenItem(null)}
          />
        ) : null}
      </Modal>
    </>
  );
}

function ShowcaseDetailContent({
  item,
  carouselIndex,
  onCarouselIndexChange,
  onClose,
}: {
  item: ShowcaseItem;
  carouselIndex: number;
  onCarouselIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const images = item.images ?? [];

  return (
    <div className="flex max-h-full w-full flex-col overflow-hidden">
      <ShowcaseCarousel
        images={images}
        alt={item.title || t("showcase.untitled")}
        index={Math.min(carouselIndex, Math.max(0, images.length - 1))}
        onIndexChange={onCarouselIndexChange}
      />
      <div className="w-full overflow-y-auto px-5 py-4 sm:px-7 sm:py-5">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-bold tracking-[-0.02em] t-primary sm:text-xl">
            {item.title || t("showcase.untitled")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary t-primary bg-button"
          >
            <i className="ri-close-line" aria-hidden="true" />
          </button>
        </div>
        {item.desc ? (
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed t-primary [overflow-wrap:anywhere]">
            {item.desc}
          </p>
        ) : null}
      </div>
    </div>
  );
}
