import { Hono } from "hono";
import type { AppContext } from "../core/hono-types";
import { profileAsync } from "../core/server-timing";
import { getEdgeCache, runCacheWrite } from "../utils/edge-cache";
import { getImagesBinding, transformImageStream } from "../utils/images";
import {
    DEFAULT_STORAGE_LIST_LIMIT,
    getStorageObject,
    getStoragePublicUrl,
    isImageStorageKey,
    listStorageImages,
    putStorageObject,
} from "../utils/storage";

function buf2hex(buffer: ArrayBuffer) {
    return [...new Uint8Array(buffer)]
        .map(x => x.toString(16).padStart(2, '0'))
        .join('');
}

/** Worker-generated thumbnails: width bounds and cache lifetime. */
const DEFAULT_THUMBNAIL_WIDTH = 240;
const MIN_THUMBNAIL_WIDTH = 16;
const MAX_THUMBNAIL_WIDTH = 1024;
const THUMBNAIL_QUALITY = 75;
/** Thumbnails are derived from content-addressed keys, so they never change. */
const THUMBNAIL_CACHE_SECONDS = 365 * 24 * 60 * 60;
/**
 * Fallback (unresized original) responses get a short TTL: they are only served
 * while the resize transform is unavailable, and caching them for a year would
 * keep stale full-size copies around after Image Resizing is enabled.
 */
const THUMBNAIL_FALLBACK_CACHE_SECONDS = 60 * 60;

function normalizeThumbnailWidth(value?: string | null) {
    const parsed = Number.parseInt(value ?? "", 10);
    if (!Number.isFinite(parsed)) {
        return DEFAULT_THUMBNAIL_WIDTH;
    }
    return Math.min(MAX_THUMBNAIL_WIDTH, Math.max(MIN_THUMBNAIL_WIDTH, parsed));
}

/** Worker-side upload size limit (bytes) — mirrors the client limit with headroom for GIFs */
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

const GIF_TYPE = "image/gif";

/**
 * Convert a GIF to Animated WebP via the configured GIF processor API.
 * Returns { bytes, contentType } or throws with a descriptive message.
 */
async function convertGifToWebP(
    serverConfig: { get(key: string): Promise<unknown> },
    file: File,
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
    const processorUrl = await serverConfig.get("image_compression.gif_processor_url");
    const processorSecret = await serverConfig.get("image_compression.gif_processor_secret");
    if (!processorUrl || typeof processorUrl !== "string" || processorUrl.trim() === "") {
        throw new Error("GIF processing is not configured (image_compression.gif_processor_url missing)");
    }

    const headers: Record<string, string> = {
        ...(processorSecret && typeof processorSecret === "string" && processorSecret.trim() !== ""
            ? { Authorization: `Bearer ${processorSecret}` }
            : {}),
    };

    // The processor expects multipart/form-data with a "file" field (multer-based API).
    // Never set Content-Type manually — fetch generates the correct multipart boundary.
    const formData = new FormData();
    formData.append("file", file, file.name || "image.gif");

    const response = await fetch(processorUrl, {
        method: "POST",
        headers,
        body: formData,
    });

    if (!response.ok) {
        throw new Error(`GIF processing failed: ${response.status} ${response.statusText}`);
    }

    const bytes = await response.arrayBuffer();
    const contentType = response.headers.get("Content-Type") || "image/webp";
    if (!bytes.byteLength) {
        throw new Error("GIF processing failed: empty response");
    }

    return { bytes, contentType };
}

export function StorageService(): Hono {
    const app = new Hono();

    // POST /storage
    app.post('/', async (c: AppContext) => {
        const uid = c.get('uid');
        const env = c.get('env');
        
        const body = await profileAsync(c, 'storage_parse', () => c.req.parseBody());
        const key = body.key as string;
        const file = body.file as File;
        
        if (!uid) {
            return c.text('Unauthorized', 401);
        }
        
        if (!file) {
            c.status(400);
            return c.text("No file uploaded");
        }

        if (file.size > MAX_UPLOAD_SIZE) {
            c.status(413);
            return c.text(`File too large (max ${Math.round(MAX_UPLOAD_SIZE / 1024 / 1024)}MB)`);
        }

        try {
            let finalBuffer: ArrayBuffer;
            let finalType: string;
            let finalSuffix: string;

            if (file.type === GIF_TYPE) {
                // GIF must keep animation — convert via processor, never store the raw GIF as WebP
                const converted = await convertGifToWebP(c.get('serverConfig'), file);
                finalBuffer = converted.bytes;
                finalType = converted.contentType;
                finalSuffix = "webp";
            } else {
                finalBuffer = await profileAsync(c, 'storage_file_buffer', () => file.arrayBuffer());
                finalType = file.type;
                const rawSuffix = key.includes(".") ? key.split('.').pop() : "";
                finalSuffix = rawSuffix || (finalType.split('/')[1] ?? "");
            }

            const hashArray = await profileAsync(c, 'storage_hash', () => crypto.subtle.digest(
                { name: 'SHA-1' },
                finalBuffer
            ));
            const hash = buf2hex(hashArray);
            const hashkey = `${hash}.${finalSuffix}`;

            const result = await profileAsync(c, 'storage_put', () => putStorageObject(env, hashkey, finalBuffer, finalType, new URL(c.req.url).origin));
            return c.json({ success: true, url: result.url });
        } catch (e: any) {
            console.error(e.message);
            const status = e.message?.includes('is not defined') ? 500 : 400;
            return c.text(e.message, status);
        }
    });

    // GET /storage/images?cursor=&limit=
    // Lists stored images (newest first) for the editor image picker.
    app.get('/images', async (c: AppContext) => {
        const uid = c.get('uid');
        if (!uid) {
            return c.text('Unauthorized', 401);
        }

        const requestedLimit = Number.parseInt(c.req.query('limit') ?? '', 10);
        try {
            const page = await profileAsync(c, 'storage_list', () =>
                listStorageImages(c.get('env'), {
                    cursor: c.req.query('cursor') || undefined,
                    limit: Number.isFinite(requestedLimit) ? requestedLimit : DEFAULT_STORAGE_LIST_LIMIT,
                    baseUrl: new URL(c.req.url).origin,
                }),
            );
            return c.json({ success: true, ...page });
        } catch (e: any) {
            console.error('storage list failed:', e?.message ?? e);
            return c.text(e?.message ?? 'Failed to list images', 500);
        }
    });

    return app;
}

export function BlobService(): Hono {
    const app = new Hono();

    // GET /blob/thumb/<key>?w=<width>
    // Thumbnail generated by this Worker (browser never talks to a resizing
    // URL of its own): the object is re-fetched with Cloudflare's `cf.image`
    // transform and cached at the edge. When the zone has no Image Resizing
    // (local dev included) the original object is streamed instead, so the
    // picker keeps working — it just transfers more bytes.
    app.get("/thumb/*", async (c: AppContext) => {
        const env = c.get("env");
        const key = decodeURIComponent(c.req.path.replace(/^\/blob\/thumb\/?/, ""));

        if (!key) {
            return c.text("Blob key is required", 400);
        }
        if (!isImageStorageKey(key)) {
            return c.text("Only images can be thumbnailed", 400);
        }

        const width = normalizeThumbnailWidth(c.req.query("w"));
        const origin = new URL(c.req.url).origin;
        const cache = getEdgeCache();
        const cacheKey = new Request(`${origin}/api/blob/thumb/${key}?w=${width}`, { method: "GET" });

        if (cache) {
            const hit = await cache.match(cacheKey);
            if (hit) {
                return hit;
            }
        }

        const headers = new Headers({
            "cache-control": `public, max-age=${THUMBNAIL_CACHE_SECONDS}, immutable`,
            "access-control-allow-origin": "*",
        });

        // The stored object is read at most once and reused by every strategy.
        let originalPromise: Promise<Response | null> | undefined;
        const readOriginal = () =>
            (originalPromise ??= profileAsync(c, "blob_thumbnail_source", () => getStorageObject(env, key)));

        const respond = (body: ArrayBuffer, contentType: string) => {
            headers.set("content-type", contentType);
            const response = new Response(body, { status: 200, headers });
            if (cache) {
                runCacheWrite(c, cache.put(cacheKey, response.clone()));
            }
            return response;
        };

        // 1. Cloudflare Images binding: transforms inside this Worker.
        const images = getImagesBinding(env);
        if (images) {
            try {
                const source = await readOriginal();
                if (source?.body) {
                    const resized = await profileAsync(c, "blob_thumbnail_binding", () =>
                        transformImageStream(images, source.body as ReadableStream<Uint8Array>, {
                            width,
                            quality: THUMBNAIL_QUALITY,
                            format: "image/webp",
                        }),
                    );

                    if (resized?.ok) {
                        return respond(
                            await resized.arrayBuffer(),
                            resized.headers.get("content-type") ?? "image/webp",
                        );
                    }
                }
            } catch (error) {
                // Storage read failed: the cf.image strategy reads the public URL
                // instead, so keep going.
                console.error("Blob thumbnail via Images binding failed:", error);
            }
        }

        // 2. Zone Image Resizing (the `cf.image` request transform).
        try {
            // A Request (rather than a bare URL) is what carries the `cf.image`
            // transform through the typed fetch overload.
            const imageRequest = new Request(getStoragePublicUrl(env, key, origin));
            const resized = await profileAsync(c, "blob_thumbnail", () =>
                fetch(imageRequest, {
                    cf: {
                        image: {
                            width,
                            fit: "scale-down",
                            quality: THUMBNAIL_QUALITY,
                            format: "webp",
                        },
                    },
                }),
            );

            const contentType = resized.headers.get("content-type") ?? "";
            if (resized.ok && contentType.toLowerCase().startsWith("image/")) {
                return respond(await resized.arrayBuffer(), contentType);
            }
        } catch (error) {
            // Image Resizing unavailable or the subrequest failed: fall back to
            // the stored object below.
            console.error("Blob thumbnail resize failed:", error);
        }

        // 3. Neither transform is available: serve the stored object as is.
        try {
            const original = await readOriginal();

            if (!original) {
                return c.text("Not found", 404);
            }

            headers.set("cache-control", `public, max-age=${THUMBNAIL_FALLBACK_CACHE_SECONDS}`);
            return respond(
                await original.arrayBuffer(),
                original.headers.get("content-type") ?? "application/octet-stream",
            );
        } catch (error) {
            console.error("Blob thumbnail failed:", error);
            return c.text("Blob thumbnail failed", 500);
        }
    });

    app.get("/*", async (c: AppContext) => {
        const env = c.get("env");
        const key = c.req.path.replace(/^\/blob\/?/, "");

        if (!key) {
            return c.text("Blob key is required", 400);
        }

        try {
            const response = await profileAsync(c, "blob_fetch", () => getStorageObject(env, decodeURIComponent(key)));

            if (!response) {
                return c.text("Not found", 404);
            }

            return new Response(response.body, {
                status: response.status,
                headers: response.headers,
            });
        } catch (error) {
            console.error("Blob fetch failed:", error);
            return c.text("Blob fetch failed", 500);
        }
    });

    return app;
}