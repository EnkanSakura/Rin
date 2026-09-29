import imageCompression from "browser-image-compression";
import { client } from "../app/runtime";
import { encodeBlurhash } from "./blurhash";

export const DEFAULT_IMAGE_MAX_FILE_SIZE = 5 * 1024 * 1024;

/** Image formats that must be uploaded as-is without re-encoding */
const PASS_THROUGH_TYPES = new Set(["image/webp", "image/avif"]);

/** GIF must be handled by the server (animated WebP conversion), never re-encoded in the browser */
const GIF_TYPE = "image/gif";

const COMPRESSION_OPTIONS = {
  maxWidthOrHeight: 1920,
  initialQuality: 0.9,
  fileType: "image/webp",
  useWebWorker: true,
};

export type UploadedImageResult = {
  url: string;
  blurhash?: string;
  width?: number;
  height?: number;
};

type ImageMetadata = {
  blurhash?: string;
  width?: number;
  height?: number;
};

type MarkdownImageMetadataResult = {
  content: string;
  updated: number;
  failed: number;
};

export function isImageFile(file: File) {
  return file.type.startsWith("image/");
}

function toPositiveInteger(value?: string | null) {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function attachImageMetadataToUrl(url: string, metadata: ImageMetadata = {}) {
  const { blurhash, width, height } = metadata;
  if (!blurhash && !width && !height) {
    return url;
  }

  const [baseUrl, fragment = ""] = url.split("#", 2);
  const params = new URLSearchParams(fragment);
  if (blurhash) {
    params.set("blurhash", blurhash);
  }
  if (width) {
    params.set("width", String(width));
  }
  if (height) {
    params.set("height", String(height));
  }
  return `${baseUrl}#${params.toString()}`;
}

export function parseImageUrlMetadata(url?: string | null) {
  if (!url) {
    return {
      src: "",
      blurhash: undefined as string | undefined,
    };
  }

  const [src, fragment = ""] = url.split("#", 2);
  const params = new URLSearchParams(fragment);

  return {
    src,
    blurhash: params.get("blurhash") || undefined,
    width: toPositiveInteger(params.get("width")),
    height: toPositiveInteger(params.get("height")),
  };
}

export function stripImageUrlMetadata(url?: string | null) {
  return parseImageUrlMetadata(url).src;
}

export function buildMarkdownImage(fileName: string, url: string, metadata: ImageMetadata = {}) {
  const safeAlt = fileName.replace(/[[\]]/g, "");
  const safeUrl = url.replace(/\s/g, "%20");
  return `![${safeAlt}](${attachImageMetadataToUrl(safeUrl, metadata)})\n`;
}

// ============================================================================
// Image picker helpers (insert dialog: thumbnail + percentage resizing)
// ============================================================================

/** Width used for the picker thumbnails served by Cloudflare Image Resizing. */
export const STORAGE_THUMBNAIL_WIDTH = 240;

export const DEFAULT_IMAGE_RESIZE_PERCENT = 100;

/** Quick presets offered next to the percentage input. */
export const IMAGE_RESIZE_PRESETS = [25, 50, 75, 100] as const;

/** Keep the percentage inside a sane range. */
export function clampImageResizePercent(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_IMAGE_RESIZE_PERCENT;
  }
  return Math.min(400, Math.max(1, Math.round(value)));
}

/**
 * Thumbnail URL for the picker.
 *
 * Uses Cloudflare Image Resizing (`/cdn-cgi/image/...`), which needs the zone
 * feature to be enabled and the image to be reachable by Cloudflare; when it is
 * not available the request fails and the caller falls back to the original
 * image. Returns `src` untouched when no origin is available to build an
 * absolute URL from.
 */
export function buildThumbnailUrl(
  url: string,
  width = STORAGE_THUMBNAIL_WIDTH,
  origin = typeof window === "undefined" ? "" : window.location.origin,
) {
  const src = stripImageUrlMetadata(url);
  if (!src) {
    return src;
  }

  let absolute = src;
  if (!/^https?:\/\//i.test(src)) {
    if (!origin) {
      return src;
    }
    absolute = `${origin}${src.startsWith("/") ? "" : "/"}${src}`;
  }

  return `/cdn-cgi/image/width=${width},fit=scale-down,quality=75/${absolute}`;
}

/**
 * Rewrite the `#width`/`#height` metadata of an image URL so the rendered image
 * is scaled by `percent` while keeping its aspect ratio.
 *
 * `base` supplies the dimensions when the URL carries none (images picked from
 * the storage list are measured in the browser), so a picked image always ends
 * up with explicit size metadata. Returns the URL unchanged when no size is
 * known at all.
 */
export function scaleImageUrl(url: string, percent: number, base: ImageMetadata = {}) {
  const { src, blurhash, width, height } = parseImageUrlMetadata(url);
  const resolvedWidth = width ?? base.width;
  const resolvedHeight = height ?? base.height;
  if (!src || (!resolvedWidth && !resolvedHeight)) {
    return url;
  }

  const factor = clampImageResizePercent(percent) / 100;
  return attachImageMetadataToUrl(src, {
    blurhash: blurhash ?? base.blurhash,
    width: resolvedWidth ? Math.max(1, Math.round(resolvedWidth * factor)) : undefined,
    height: resolvedHeight ? Math.max(1, Math.round(resolvedHeight * factor)) : undefined,
  });
}

/** Human readable file size for the picker info row. */
export function formatImageSize(bytes?: number) {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) {
    return "—";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 || value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** Alt/label text for a stored object (`images/ab12.webp` → `ab12.webp`). */
export function imageNameFromKey(key: string) {
  const segment = key.split("/").filter(Boolean).pop() ?? key;
  return segment;
}

async function loadImage(file: File) {
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Failed to load image"));
      element.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function loadImageFromUrl(url: string) {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.crossOrigin = "anonymous";
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    element.src = url;
  });
  return image;
}

async function loadImageWithoutCors(url: string) {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    element.src = url;
  });
  return image;
}

/**
 * Size metadata for an image that is already stored, used by the picker's
 * "existing images" tab. Blurhash needs a CORS-clean canvas, so it is only
 * attached when available; plain dimensions are measured either way.
 */
export async function measureImageMetadata(url: string): Promise<ImageMetadata> {
  try {
    return await generateImageMetadataFromUrl(url);
  } catch {
    // Fall through to a CORS-free dimension probe.
  }

  try {
    const image = await loadImageWithoutCors(stripImageUrlMetadata(url));
    return {
      width: image.naturalWidth || undefined,
      height: image.naturalHeight || undefined,
    };
  } catch {
    return {};
  }
}

export async function generateImageMetadata(file: File) {
  if (!isImageFile(file)) {
    return {};
  }

  const image = await loadImage(file);
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
  if (!longestSide) {
    return {};
  }

  const scale = Math.min(1, 48 / longestSide);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return {};
  }

  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  return {
    blurhash: encodeBlurhash(imageData.data, width, height, 4, 3),
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
}

export async function generateImageMetadataFromUrl(url: string): Promise<ImageMetadata> {
  const { src, blurhash, width, height } = parseImageUrlMetadata(url);
  if (blurhash && width && height) {
    return { blurhash, width, height };
  }

  const image = await loadImageFromUrl(src);
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
  if (!longestSide) {
    return {
      blurhash,
      width: width || undefined,
      height: height || undefined,
    };
  }

  const scale = Math.min(1, 48 / longestSide);
  const canvas = document.createElement("canvas");
  const canvasWidth = Math.max(1, Math.round(image.naturalWidth * scale));
  const canvasHeight = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return {
      blurhash,
      width: width || image.naturalWidth || undefined,
      height: height || image.naturalHeight || undefined,
    };
  }

  context.drawImage(image, 0, 0, canvasWidth, canvasHeight);
  const imageData = context.getImageData(0, 0, canvasWidth, canvasHeight);

  return {
    blurhash: blurhash || encodeBlurhash(imageData.data, canvasWidth, canvasHeight, 4, 3),
    width: width || image.naturalWidth || undefined,
    height: height || image.naturalHeight || undefined,
  };
}

export async function enrichMarkdownImageMetadata(content: string): Promise<MarkdownImageMetadataResult> {
  const markdownPattern = /!\[(.*?)\]\((\S+?)(?:\s+"[^"]*")?\)/g;
  const htmlPattern = /<img\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*?)>/gi;
  const markdownMatches = [...content.matchAll(markdownPattern)].map((match) => ({
    type: "markdown" as const,
    fullMatch: match[0],
    alt: match[1] || "",
    rawUrl: match[2],
  }));
  const htmlMatches = [...content.matchAll(htmlPattern)].map((match) => ({
    type: "html" as const,
    fullMatch: match[0],
    beforeSrc: match[1] || "",
    rawUrl: match[2],
    afterSrc: match[3] || "",
  }));
  const matches = [...markdownMatches, ...htmlMatches];

  if (matches.length === 0) {
    return { content, updated: 0, failed: 0 };
  }

  let nextContent = content;
  let updated = 0;
  let failed = 0;

  for (const match of matches) {
    const { fullMatch, rawUrl } = match;
    if (!fullMatch || !rawUrl) {
      continue;
    }

    const existing = parseImageUrlMetadata(rawUrl);
    if (existing.blurhash && existing.width && existing.height) {
      continue;
    }

    try {
      const metadata = await generateImageMetadataFromUrl(rawUrl);
      if (!metadata.blurhash || !metadata.width || !metadata.height) {
        failed += 1;
        continue;
      }

      const nextUrl = attachImageMetadataToUrl(existing.src, metadata);
      const replacement = match.type === "markdown"
        ? `![${match.alt}](${nextUrl})`
        : `<img${match.beforeSrc}src="${nextUrl}"${match.afterSrc}>`;
      if (replacement !== fullMatch) {
        nextContent = nextContent.replace(fullMatch, replacement);
        updated += 1;
      }
    } catch {
      failed += 1;
    }
  }

  return {
    content: nextContent,
    updated,
    failed,
  };
}

/**
 * Prepare an image file for upload according to its format:
 * - WebP / AVIF: returned as-is (no re-encoding)
 * - GIF: returned as-is (server converts to animated WebP)
 * - Other static images (JPG/PNG/etc.): compressed and converted to WebP in the browser
 *
 * Throws on compression failure — never falls back to uploading the original file.
 */
export async function prepareImageForUpload(file: File): Promise<File> {
  const mimeType = file.type.toLowerCase();

  if (PASS_THROUGH_TYPES.has(mimeType) || mimeType === GIF_TYPE) {
    return file;
  }

  try {
    const compressed = await imageCompression(file, COMPRESSION_OPTIONS);
    // browser-image-compression returns a Blob; wrap it as a File with a .webp name
    return new File([compressed], `${file.name.replace(/\.[^/.]+$/, "")}.webp`, {
      type: "image/webp",
    });
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Image compression failed: ${error.message}`
        : "Image compression failed",
    );
  }
}

export async function uploadImageFile(file: File): Promise<UploadedImageResult> {
  const preparedFile = await prepareImageForUpload(file);
  const [uploadResult, metadataResult] = await Promise.allSettled([
    client.storage.upload(preparedFile, preparedFile.name),
    generateImageMetadata(preparedFile),
  ]);

  if (uploadResult.status === "rejected") {
    throw uploadResult.reason instanceof Error
      ? uploadResult.reason
      : new Error("Upload failed");
  }

  const { data, error } = uploadResult.value;
  if (error) {
    throw new Error(error.value);
  }

  const url =
    typeof data === "string"
      ? data
      : data?.url;

  if (!url) {
    throw new Error("Invalid upload response");
  }

  return {
    url,
    ...(metadataResult.status === "fulfilled" ? metadataResult.value : {}),
  };
}