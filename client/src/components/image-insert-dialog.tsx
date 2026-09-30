import type { StorageImageItem } from "@rin/api";
import { Button, FlatInset, FlatTabButton, Modal } from "@rin/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactLoading from "react-loading";
import { client } from "../app/runtime";
import {
  DEFAULT_IMAGE_MAX_FILE_SIZE,
  DEFAULT_IMAGE_RESIZE_PERCENT,
  IMAGE_RESIZE_PRESETS,
  buildStorageThumbnailUrl,
  clampImageResizePercent,
  formatImageSize,
  imageNameFromKey,
  isImageFile,
  measureImageMetadata,
  scaleImageUrl,
  stripImageUrlMetadata,
  uploadImageFile,
} from "../utils/image-upload";

/** An image selected in the dialog, before the percentage is applied. */
export type PickedImage = {
  url: string;
  name: string;
  size?: number;
  width?: number;
  height?: number;
  blurhash?: string;
};

export type InsertImagePayload = {
  /** Final URL, with width/height metadata scaled to the chosen percentage. */
  url: string;
  name: string;
};

type ImageListPage = { items: StorageImageItem[]; cursor: string | null; total: number };

export type ImageInsertDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (payload: InsertImagePayload) => void;
  onError?: (message: string) => void;
  /** Injectable for tests. */
  listImages?: (params: { cursor?: string; limit?: number }) => Promise<ImageListPage>;
  uploadImage?: (file: File) => Promise<PickedImage>;
  measureImage?: (url: string) => Promise<{ width?: number; height?: number; blurhash?: string }>;
  pageSize?: number;
};

const DEFAULT_PAGE_SIZE = 36;

async function defaultListImages(params: { cursor?: string; limit?: number }): Promise<ImageListPage> {
  const { data, error } = await client.storage.listImages(params);
  if (error) {
    throw new Error(error.value);
  }
  if (!data) {
    throw new Error("Invalid image list response");
  }
  return { items: data.items ?? [], cursor: data.cursor ?? null, total: data.total ?? 0 };
}

async function defaultUploadImage(file: File): Promise<PickedImage> {
  const result = await uploadImageFile(file);
  return {
    url: result.url,
    name: file.name,
    size: file.size,
    width: result.width,
    height: result.height,
    blurhash: result.blurhash,
  };
}

function InfoChip({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <span
      title={title ?? value}
      className="inline-flex max-w-full items-center gap-1 rounded-full border border-black/10 bg-secondary px-3 py-1 text-xs t-secondary dark:border-white/10"
    >
      <span className="shrink-0 text-neutral-400">{label}</span>
      <span className="truncate font-medium t-primary">{value}</span>
    </span>
  );
}

/** Thumbnail rendered by the site Worker, falling back to the original object. */
function Thumbnail({ url, storageKey, alt }: { url: string; storageKey: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  const src = failed ? stripImageUrlMetadata(url) : buildStorageThumbnailUrl(storageKey);

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover"
    />
  );
}

function NewImagePanel({
  onPicked,
  onError,
  uploadImage,
}: {
  onPicked: (image: PickedImage) => void;
  onError: (message: string) => void;
  uploadImage: (file: File) => Promise<PickedImage>;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const handleFile = async (file: File) => {
    if (!isImageFile(file)) {
      onError(t("upload.image.invalid_type"));
      return;
    }
    if (file.size > DEFAULT_IMAGE_MAX_FILE_SIZE) {
      onError(
        t("upload.failed$size", { size: Math.round(DEFAULT_IMAGE_MAX_FILE_SIZE / 1024 / 1024) }),
      );
      return;
    }

    setUploading(true);
    try {
      onPicked(await uploadImage(file));
    } catch (error) {
      onError(error instanceof Error ? error.message : t("upload.failed"));
    } finally {
      setUploading(false);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  };

  return (
    <div className="space-y-3">
      <div
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
          dragging
            ? "border-theme bg-theme/5"
            : "border-black/10 bg-black/[0.02] dark:border-white/10 dark:bg-white/[0.03]"
        } ${uploading ? "pointer-events-none opacity-60" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          if (!uploading) {
            setDragging(true);
          }
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (uploading) {
            return;
          }
          const file = event.dataTransfer.files?.[0];
          if (file) {
            void handleFile(file);
          }
        }}
      >
        {uploading ? (
          <ReactLoading type="spin" color="#FC466B" height={22} width={22} />
        ) : (
          <i className="ri-upload-cloud-2-line text-3xl text-neutral-400" aria-hidden="true" />
        )}
        <p className="text-sm font-medium t-primary">
          {uploading ? t("uploading") : t("upload.image.dialog.new_hint")}
        </p>
        <p className="text-xs t-secondary">{t("upload.image.drag_hint")}</p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={uploading}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void handleFile(file);
          }
        }}
      />
    </div>
  );
}

function ExistingImagePanel({
  selectedUrl,
  onPicked,
  onError,
  listImages,
  measureImage,
  pageSize,
}: {
  selectedUrl?: string;
  onPicked: (image: PickedImage, pending?: boolean) => void;
  onError: (message: string) => void;
  listImages: (params: { cursor?: string; limit?: number }) => Promise<ImageListPage>;
  measureImage: (url: string) => Promise<{ width?: number; height?: number; blurhash?: string }>;
  pageSize: number;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<StorageImageItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [measuringUrl, setMeasuringUrl] = useState<string | null>(null);

  // Keep the callbacks in refs so the initial load only ever runs once, even
  // though the parent re-creates its handlers on every render.
  const listImagesRef = useRef(listImages);
  const onErrorRef = useRef(onError);
  const translateRef = useRef(t);
  listImagesRef.current = listImages;
  onErrorRef.current = onError;
  translateRef.current = t;

  const loadPage = useCallback(
    async (nextCursor?: string) => {
      try {
        const page = await listImagesRef.current({ cursor: nextCursor, limit: pageSize });
        setItems((current) => (nextCursor ? [...current, ...page.items] : page.items));
        setCursor(page.cursor);
        setTotal(page.total);
        setFailed(false);
      } catch (error) {
        setFailed(true);
        onErrorRef.current(error instanceof Error ? error.message : translateRef.current("upload.failed"));
      }
    },
    [pageSize],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadPage().finally(() => {
      if (!cancelled) {
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadPage]);

  const handleSelect = async (item: StorageImageItem) => {
    const image: PickedImage = {
      url: item.url,
      name: imageNameFromKey(item.key),
      size: item.size,
    };
    onPicked(image, true);

    setMeasuringUrl(item.url);
    try {
      const metadata = await measureImage(item.url);
      onPicked({ ...image, ...metadata });
    } catch {
      // Dimensions are optional: the percentage control then leaves the URL as is.
      onPicked(image);
    } finally {
      setMeasuringUrl(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <ReactLoading type="spin" color="#FC466B" height={22} width={22} />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-neutral-500">
        {failed ? t("upload.failed") : t("upload.image.dialog.existing_empty")}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs t-secondary">
        {t("upload.image.dialog.existing_total$count", { count: total })}
      </p>

      <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-5 md:grid-cols-6">
        {items.map((item) => {
          const selected = selectedUrl === item.url;
          return (
            <button
              key={item.key}
              type="button"
              title={item.key}
              onClick={() => void handleSelect(item)}
              className={`relative aspect-square overflow-hidden rounded-xl border bg-black/[0.03] transition-colors dark:bg-white/[0.04] ${
                selected ? "border-theme ring-2 ring-theme/30" : "border-black/10 hover:border-theme/40 dark:border-white/10"
              }`}
            >
              <Thumbnail url={item.url} storageKey={item.key} alt={imageNameFromKey(item.key)} />
              {measuringUrl === item.url ? (
                <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <ReactLoading type="spin" color="#ffffff" height={16} width={16} />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {cursor ? (
        <div className="flex justify-center">
          <Button
            secondary
            title={t("upload.image.dialog.existing_load_more")}
            disabled={loadingMore}
            onClick={() => {
              setLoadingMore(true);
              void loadPage(cursor).finally(() => setLoadingMore(false));
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function ImageDetails({
  picked,
  percent,
  onPercentChange,
  measuring,
}: {
  picked: PickedImage;
  percent: number;
  onPercentChange: (value: number) => void;
  measuring: boolean;
}) {
  const { t } = useTranslation();
  const scaledUrl = scaleImageUrl(picked.url, percent, picked);
  const { width, height } = parseScaledSize(scaledUrl, picked);
  const commitPercent = (value: string) => onPercentChange(clampImageResizePercent(Number(value)));

  return (
    <FlatInset className="space-y-3 p-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-black/10 bg-black/[0.03] dark:border-white/10 dark:bg-white/[0.04]">
          <img
            src={stripImageUrlMetadata(picked.url)}
            alt={picked.name}
            className="h-full w-full object-cover"
          />
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <InfoChip label={t("upload.image.dialog.field_name")} value={picked.name} />
            <InfoChip label={t("upload.image.dialog.field_size")} value={formatImageSize(picked.size)} />
            <InfoChip
              label={t("upload.image.dialog.field_original")}
              value={formatDimensions(picked.width, picked.height)}
            />
            <InfoChip
              label={t("upload.image.dialog.field_scaled")}
              value={formatDimensions(width, height)}
            />
          </div>
          <p className="truncate text-xs t-secondary" title={picked.url}>
            {t("upload.image.dialog.field_url")}: {stripImageUrlMetadata(picked.url)}
          </p>
          {measuring ? (
            <p className="text-xs t-secondary">{t("upload.image.dialog.measuring")}</p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs t-secondary" htmlFor="rin-image-scale">
          {t("upload.image.dialog.scale_label")}
        </label>
        <input
          id="rin-image-scale"
          type="number"
          min={1}
          max={400}
          value={percent}
          onChange={(event) => commitPercent(event.target.value)}
          // Mirrors onChange so programmatic input events (jsdom tests, browser
          // autofill) update the controlled value as well.
          onInput={(event) => commitPercent(event.currentTarget.value)}
          className="w-20 rounded-xl border border-black/10 bg-w px-2 py-1 text-sm t-primary outline-none focus:border-black/20 dark:border-white/10 dark:focus:border-white/20"
        />
        <span className="text-xs t-secondary">%</span>
        <div className="flex flex-wrap gap-1.5">
          {IMAGE_RESIZE_PRESETS.map((preset) => (
            <FlatTabButton
              key={preset}
              type="button"
              active={percent === preset}
              onClick={() => onPercentChange(preset)}
              className="border border-black/10 text-xs dark:border-white/10"
            >
              {preset}%
            </FlatTabButton>
          ))}
        </div>
      </div>
    </FlatInset>
  );
}

function formatDimensions(width?: number, height?: number) {
  if (!width && !height) {
    return "—";
  }
  return `${width ?? "?"} × ${height ?? "?"}`;
}

function parseScaledSize(url: string, picked: PickedImage) {
  const [, fragment = ""] = url.split("#", 2);
  const params = new URLSearchParams(fragment);
  const width = Number.parseInt(params.get("width") ?? "", 10);
  const height = Number.parseInt(params.get("height") ?? "", 10);
  return {
    width: Number.isFinite(width) ? width : picked.width,
    height: Number.isFinite(height) ? height : picked.height,
  };
}

export function ImageInsertDialog({
  isOpen,
  onClose,
  onInsert,
  onError,
  listImages = defaultListImages,
  uploadImage = defaultUploadImage,
  measureImage = measureImageMetadata,
  pageSize = DEFAULT_PAGE_SIZE,
}: ImageInsertDialogProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"new" | "existing">("new");
  const [picked, setPicked] = useState<PickedImage | null>(null);
  const [percent, setPercent] = useState<number>(DEFAULT_IMAGE_RESIZE_PERCENT);
  const [measuring, setMeasuring] = useState(false);

  // Every open starts on the "new" tab with no selection.
  useEffect(() => {
    if (isOpen) {
      setTab("new");
      setPicked(null);
      setPercent(DEFAULT_IMAGE_RESIZE_PERCENT);
      setMeasuring(false);
    }
  }, [isOpen]);

  const showError = (message: string) => {
    onError?.(message || t("upload.failed"));
  };

  const handlePicked = (image: PickedImage, pending = false) => {
    setPicked(image);
    setMeasuring(pending);
  };

  return (
    <Modal
      isOpen={isOpen}
      onRequestClose={onClose}
      contentLabel={t("upload.image.dialog.title")}
      size="lg"
      panelClassName="p-5 sm:p-6"
    >
      <div className="flex max-h-[80vh] w-full flex-col gap-4 overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold tracking-[-0.02em] t-primary">
            {t("upload.image.dialog.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("cancel")}
            className="rounded-xl p-1 text-lg t-secondary transition-colors hover:bg-black/5 dark:hover:bg-white/10"
          >
            <i className="ri-close-line" aria-hidden="true" />
          </button>
        </div>

        <FlatInset className="flex w-fit gap-1 p-1">
          <FlatTabButton
            type="button"
            active={tab === "new"}
            onClick={() => {
              setTab("new");
            }}
          >
            {t("upload.image.dialog.tab_new")}
          </FlatTabButton>
          <FlatTabButton
            type="button"
            active={tab === "existing"}
            onClick={() => {
              setTab("existing");
            }}
          >
            {t("upload.image.dialog.tab_existing")}
          </FlatTabButton>
        </FlatInset>

        {tab === "new" ? (
          <NewImagePanel
            uploadImage={uploadImage}
            onError={showError}
            onPicked={(image) => handlePicked(image)}
          />
        ) : (
          <ExistingImagePanel
            selectedUrl={picked ? stripImageUrlMetadata(picked.url) : undefined}
            listImages={listImages}
            measureImage={measureImage}
            pageSize={pageSize}
            onError={showError}
            onPicked={handlePicked}
          />
        )}

        {picked ? (
          <ImageDetails
            picked={picked}
            percent={percent}
            measuring={measuring}
            onPercentChange={(value) => setPercent(clampImageResizePercent(value))}
          />
        ) : (
          <p className="py-2 text-center text-xs t-secondary">
            {t("upload.image.dialog.pick_hint")}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button secondary title={t("cancel")} onClick={onClose} />
          <Button
            title={t("upload.image.dialog.insert")}
            disabled={!picked || measuring}
            onClick={() => {
              if (!picked) {
                return;
              }
              onInsert({ url: scaleImageUrl(picked.url, percent, picked), name: picked.name });
              onClose();
            }}
          />
        </div>
      </div>
    </Modal>
  );
}
