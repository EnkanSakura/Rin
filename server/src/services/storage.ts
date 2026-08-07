import { Hono } from "hono";
import type { AppContext } from "../core/hono-types";
import { profileAsync } from "../core/server-timing";
import { getStorageObject, putStorageObject } from "../utils/storage";

function buf2hex(buffer: ArrayBuffer) {
    return [...new Uint8Array(buffer)]
        .map(x => x.toString(16).padStart(2, '0'))
        .join('');
}

/** Worker-side upload size limit (bytes) — mirrors the client limit with headroom for GIFs */
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

const GIF_TYPE = "image/gif";

/**
 * Convert a GIF to Animated WebP via the configured GIF processor API.
 * Returns { bytes, contentType } or throws with a descriptive message.
 */
async function convertGifToWebP(env: Env, file: File): Promise<{ bytes: ArrayBuffer; contentType: string }> {
    const processorUrl = env.GIF_PROCESSOR_URL;
    if (!processorUrl) {
        throw new Error("GIF processing is not configured (GIF_PROCESSOR_URL missing)");
    }

    const headers: Record<string, string> = {
        "Content-Type": file.type || "application/octet-stream",
    };
    if (env.GIF_PROCESSOR_SECRET) {
        headers["Authorization"] = `Bearer ${env.GIF_PROCESSOR_SECRET}`;
    }

    const response = await fetch(processorUrl, {
        method: "POST",
        headers,
        body: file,
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
                const converted = await convertGifToWebP(env, file);
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

    return app;
}

export function BlobService(): Hono {
    const app = new Hono();

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