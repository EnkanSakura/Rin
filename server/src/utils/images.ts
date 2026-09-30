/**
 * Cloudflare Images binding helpers.
 *
 * `wrangler.toml` binds the Images product as `IMAGES` (`[images] binding =
 * "IMAGES"`). That binding is the Worker-side way to transform images, so the
 * thumbnail route prefers it, then falls back to the `cf.image` request
 * transform, then to serving the stored object unchanged.
 */

/** The Images binding, or null when the Worker was deployed without it. */
export function getImagesBinding(env: Env): ImagesBinding | null {
    // Read through a widened type: the generated Env only declares IMAGES once
    // wrangler types ran with the binding configured.
    const binding = (env as Env & { IMAGES?: ImagesBinding }).IMAGES;
    return binding && typeof binding.input === "function" ? binding : null;
}

export type ImagesOutputFormat = "image/webp" | "image/avif" | "image/jpeg" | "image/png";

/**
 * Resize an image stream inside the Worker.
 * Returns null when the transform is unsupported or fails, so callers can fall
 * back to another strategy.
 */
export async function transformImageStream(
    binding: ImagesBinding,
    stream: ReadableStream<Uint8Array>,
    options: { width: number; quality: number; format: ImagesOutputFormat },
): Promise<Response | null> {
    try {
        const result = await binding
            .input(stream)
            .transform({ width: options.width, fit: "scale-down" })
            .output({ format: options.format, quality: options.quality });

        return result.response();
    } catch (error) {
        console.error("Images binding transform failed:", error);
        return null;
    }
}
