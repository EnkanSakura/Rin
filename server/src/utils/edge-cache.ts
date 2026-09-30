import type { AppContext } from "../core/hono-types";

/** The slice of the Cloudflare Cache API these routes need. */
export interface EdgeCache {
    match(request: Request): Promise<Response | undefined>;
    put(request: Request, response: Response): Promise<void>;
}

/**
 * Cloudflare edge cache, or null when the runtime has no Cache API (tests,
 * Bun). Read through `globalThis` so routes stay independent of which `caches`
 * declaration the active tsconfig picks up.
 */
export function getEdgeCache(): EdgeCache | null {
    const globalCaches = (globalThis as { caches?: { default?: EdgeCache } }).caches;
    return globalCaches?.default ?? null;
}

/** Run a cache write without blocking the response when waitUntil is available. */
export function runCacheWrite(c: AppContext, task: Promise<unknown>): void {
    const guarded = task.catch((error) => {
        console.error(`[Cache] background write failed: ${String(error)}`);
    });
    try {
        c.executionCtx.waitUntil(guarded);
    } catch {
        // No execution context (tests): the cache is disabled there anyway.
        void guarded;
    }
}
