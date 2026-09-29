import type { StorageImageItem } from "@rin/api";
import { XMLParser } from "fast-xml-parser";
import { path_join } from "./path";
import {
  buildS3ListUrl,
  buildS3ObjectUrl,
  createS3Client,
  putObject as putS3Object,
} from "./s3";

type StorageTarget =
  | {
      type: "r2";
      bucket: R2Bucket;
      folder: string;
      publicBaseUrl: string;
    }
  | {
      type: "s3";
      env: Env;
      folder: string;
      publicBaseUrl: string;
    };

function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function resolveStorageTarget(env: Env): StorageTarget {
  const folder = env.S3_FOLDER || "";
  const publicBaseUrl = trimTrailingSlash(env.S3_ACCESS_HOST || env.S3_ENDPOINT || "");

  if (env.R2_BUCKET) {
    return {
      type: "r2",
      bucket: env.R2_BUCKET,
      folder,
      publicBaseUrl,
    };
  }

  if (!env.S3_ENDPOINT) {
    throw new Error("S3_ENDPOINT is not defined");
  }
  if (!env.S3_ACCESS_KEY_ID) {
    throw new Error("S3_ACCESS_KEY_ID is not defined");
  }
  if (!env.S3_SECRET_ACCESS_KEY) {
    throw new Error("S3_SECRET_ACCESS_KEY is not defined");
  }
  if (!env.S3_BUCKET) {
    throw new Error("S3_BUCKET is not defined");
  }

  return {
    type: "s3",
    env,
    folder,
    publicBaseUrl,
  };
}

function encodeStorageKey(key: string) {
  return key
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildBlobUrl(storageKey: string, baseUrl?: string) {
  const encodedKey = encodeStorageKey(storageKey);
  const path = `/api/blob/${encodedKey}`;

  if (!baseUrl) {
    return path;
  }

  return `${trimTrailingSlash(baseUrl)}${path}`;
}

function createStorageResponse(object: R2ObjectBody | R2Object, body?: BodyInit | null) {
  const headers = new Headers();
  object.writeHttpMetadata(headers);

  if (object.httpEtag) {
    headers.set("ETag", object.httpEtag);
  }

  if (!headers.has("Content-Length")) {
    headers.set("Content-Length", String(object.size));
  }

  if (!headers.has("Last-Modified")) {
    headers.set("Last-Modified", object.uploaded.toUTCString());
  }

  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
  }

  if (!headers.has("Access-Control-Allow-Origin")) {
    headers.set("Access-Control-Allow-Origin", "*");
  }

  return new Response(body ?? null, {
    status: 200,
    headers,
  });
}

export async function getStorageObject(env: Env, storageKey: string): Promise<Response | null> {
  if (env.R2_BUCKET) {
    const object = await env.R2_BUCKET.get(storageKey);
    if (!object) {
      return null;
    }
    return createStorageResponse(object, object.body);
  }

  const client = createS3Client(env);
  const response = await client.fetch(buildS3ObjectUrl(env, storageKey), {
    method: "GET",
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch storage object: ${response.status} ${response.statusText}`);
  }

  return response;
}

export async function headStorageObject(env: Env, storageKey: string): Promise<Response | null> {
  if (env.R2_BUCKET) {
    const object = await env.R2_BUCKET.head(storageKey);
    if (!object) {
      return null;
    }
    return createStorageResponse(object);
  }

  const client = createS3Client(env);
  const response = await client.fetch(buildS3ObjectUrl(env, storageKey), {
    method: "HEAD",
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to inspect storage object: ${response.status} ${response.statusText}`);
  }

  return response;
}

export function getStoragePublicUrl(env: Env, storageKey: string, baseUrl?: string) {
  if (env.S3_ACCESS_HOST) {
    return `${trimTrailingSlash(env.S3_ACCESS_HOST)}/${storageKey}`;
  }

  return buildBlobUrl(storageKey, baseUrl);
}

export async function putStorageObject(
  env: Env,
  key: string,
  body: Blob | ArrayBuffer | Uint8Array | string,
  contentType?: string,
  baseUrl?: string,
) {
  const target = resolveStorageTarget(env);
  const storageKey = path_join(target.folder, key);

  return putStorageObjectAtKey(env, storageKey, body, contentType, baseUrl);
}

export async function putStorageObjectAtKey(
  env: Env,
  storageKey: string,
  body: Blob | ArrayBuffer | Uint8Array | string,
  contentType?: string,
  baseUrl?: string,
) {
  if (env.R2_BUCKET) {
    await env.R2_BUCKET.put(storageKey, body, {
      httpMetadata: contentType ? { contentType } : undefined,
    });
  } else {
    const client = createS3Client(env);
    await putS3Object(client, env, storageKey, body, contentType);
  }

  return {
    key: storageKey,
    url: getStoragePublicUrl(env, storageKey, baseUrl),
  };
}

// ============================================================================
// Image listing (admin picker: "already uploaded" images)
// ============================================================================

/** File extensions treated as images when listing the bucket. */
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "svg"]);

/** Objects fetched per storage request (R2 / S3 both cap this at 1000). */
const STORAGE_LIST_PAGE_LIMIT = 1000;

/**
 * Upper bound of objects scanned to build the picker index. The whole index is
 * read to sort images by upload time, which keeps the picker stable while the
 * bucket is personal-blog sized.
 */
const STORAGE_IMAGE_INDEX_LIMIT = 2000;

export const DEFAULT_STORAGE_LIST_LIMIT = 60;
export const MAX_STORAGE_LIST_LIMIT = 200;

export interface StorageImagePage {
  items: StorageImageItem[];
  /** Offset cursor for the next page, or null when the list is exhausted. */
  cursor: string | null;
  /** Total number of indexed images. */
  total: number;
}

/** Is this storage key an image we can show in the picker? */
export function isImageStorageKey(key: string) {
  const extension = key.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(extension);
}

export function normalizeStorageListLimit(value?: number) {
  if (!value || !Number.isFinite(value)) {
    return DEFAULT_STORAGE_LIST_LIMIT;
  }
  return Math.min(MAX_STORAGE_LIST_LIMIT, Math.max(1, Math.trunc(value)));
}

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, "");
}

function storageImagePrefix(env: Env) {
  const folder = trimTrailingSlashes(env.S3_FOLDER || "");
  return folder ? `${folder}/` : "";
}

type IndexedObject = { key: string; size: number; uploadedAt: Date };

function parseS3ListPage(xml: string): { objects: IndexedObject[]; nextToken: string | null } {
  const parsed = new XMLParser({ ignoreAttributes: true }).parse(xml) as {
    ListBucketResult?: {
      Contents?: unknown;
      IsTruncated?: unknown;
      NextContinuationToken?: unknown;
    };
  };
  const result = parsed?.ListBucketResult ?? {};
  const rawContents = result.Contents;
  const entries = Array.isArray(rawContents) ? rawContents : rawContents ? [rawContents] : [];

  const objects: IndexedObject[] = [];
  for (const entry of entries) {
    const record = entry as { Key?: unknown; Size?: unknown; LastModified?: unknown };
    const key = typeof record.Key === "string" ? record.Key : "";
    if (!key) {
      continue;
    }
    const uploaded = new Date(String(record.LastModified ?? ""));
    objects.push({
      key,
      size: Number(record.Size ?? 0) || 0,
      uploadedAt: Number.isNaN(uploaded.getTime()) ? new Date(0) : uploaded,
    });
  }

  const truncated = String(result.IsTruncated ?? "false") === "true";
  const token = truncated && result.NextContinuationToken ? String(result.NextContinuationToken) : null;
  return { objects, nextToken: token };
}

async function listStorageObjects(env: Env, prefix: string): Promise<IndexedObject[]> {
  const objects: IndexedObject[] = [];

  if (env.R2_BUCKET) {
    const bucket = env.R2_BUCKET;
    let cursor: string | undefined;
    while (objects.length < STORAGE_IMAGE_INDEX_LIMIT) {
      const listed = await bucket.list({ prefix, cursor, limit: STORAGE_LIST_PAGE_LIMIT });
      for (const object of listed.objects) {
        objects.push({ key: object.key, size: object.size, uploadedAt: object.uploaded });
      }
      if (!listed.truncated || !listed.cursor) {
        break;
      }
      cursor = listed.cursor;
    }
    return objects;
  }

  const client = createS3Client(env);
  let token: string | undefined;
  while (objects.length < STORAGE_IMAGE_INDEX_LIMIT) {
    const response = await client.fetch(
      buildS3ListUrl(env, {
        prefix,
        maxKeys: STORAGE_LIST_PAGE_LIMIT,
        continuationToken: token,
      }),
      { method: "GET" },
    );
    if (!response.ok) {
      throw new Error(`Failed to list storage objects: ${response.status} ${response.statusText}`);
    }
    const page = parseS3ListPage(await response.text());
    objects.push(...page.objects);
    if (!page.nextToken) {
      break;
    }
    token = page.nextToken;
  }
  return objects;
}

/**
 * Images available in the configured storage, newest first, with an opaque
 * offset cursor for the next page.
 */
export async function listStorageImages(
  env: Env,
  options: { cursor?: string; limit?: number; baseUrl?: string } = {},
): Promise<StorageImagePage> {
  const limit = normalizeStorageListLimit(options.limit);
  const parsedOffset = Number.parseInt(options.cursor ?? "0", 10);
  const offset = Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0;

  const cachePrefix = `${trimTrailingSlashes(env.S3_CACHE_FOLDER || "cache")}/`;
  const objects = await listStorageObjects(env, storageImagePrefix(env));
  const images = objects
    .filter((object) => isImageStorageKey(object.key) && !object.key.startsWith(cachePrefix))
    .sort((left, right) => right.uploadedAt.getTime() - left.uploadedAt.getTime());

  const page = images.slice(offset, offset + limit).map((object) => ({
    key: object.key,
    url: getStoragePublicUrl(env, object.key, options.baseUrl),
    size: object.size,
    uploadedAt: object.uploadedAt.toISOString(),
  }));

  const nextOffset = offset + limit;
  return {
    items: page,
    cursor: nextOffset < images.length ? String(nextOffset) : null,
    total: images.length,
  };
}
