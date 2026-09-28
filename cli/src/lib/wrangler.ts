import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const require = createRequire(import.meta.url);

const WORKERD_PLATFORM_PACKAGE = "@cloudflare/workerd-windows-64";
const WORKERD_BINARY_SUBPATH = "bin/workerd.exe";
/** Per-user cache directory that holds the relocated runtime. */
const RUNTIME_CACHE_DIRNAME = "rin";

/** Is `target` inside `directory` (and not the directory itself)? */
export function isInsideDirectory(target: string, directory: string) {
  const relative = path.relative(path.resolve(directory), path.resolve(target));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** Absolute path of the workerd binary installed for this platform, if any. */
export function resolveInstalledWorkerd(): string | undefined {
  if (process.platform !== "win32") {
    return undefined;
  }
  try {
    return require.resolve(`${WORKERD_PLATFORM_PACKAGE}/${WORKERD_BINARY_SUBPATH}`);
  } catch {
    return undefined;
  }
}

/**
 * Where the relocated runtime is cached: the per-user app data directory, so it
 * is stable across reboots and never inside the checkout.
 */
export function workerdCacheRoot() {
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    return path.join(localAppData, RUNTIME_CACHE_DIRNAME, "workerd");
  }
  return path.join(os.tmpdir(), RUNTIME_CACHE_DIRNAME, "workerd");
}

/**
 * Path of the runtime `wrangler`/`miniflare` should launch, when it has to be
 * relocated out of the project directory.
 *
 * On some Windows setups (agent sandboxes, security products and filter
 * drivers watching the checkout) `workerd.exe` dies with `std::terminate()`
 * while starting up whenever it is launched from a path inside the project
 * tree, even though a byte-identical copy elsewhere runs fine. `wrangler` then
 * reports "The Workers runtime failed to start", which breaks `bun dev` at its
 * very first step (the local D1 migration).
 *
 * The runtime is therefore executed from a cached copy in the per-user app data
 * directory — one file per workerd build, reused across runs. Returns
 * `undefined` when no relocation is needed or possible; an explicitly set
 * `MINIFLARE_WORKERD_PATH` always wins (see `getWranglerEnv`).
 */
export function resolveWorkerdRuntime(projectDir = process.cwd()): string | undefined {
  const installed = resolveInstalledWorkerd();
  if (!installed || !isInsideDirectory(installed, projectDir)) {
    return undefined;
  }

  let version = "unknown";
  try {
    const manifest = require(`${WORKERD_PLATFORM_PACKAGE}/package.json`) as { version?: string };
    version = manifest.version ?? version;
  } catch {
    // Keep the fallback label; the cached copy is still keyed by size below.
  }

  try {
    const size = fs.statSync(installed).size;
    const target = path.join(workerdCacheRoot(), `workerd-${version}-${size}.exe`);
    const cachedSize = fs.existsSync(target) ? fs.statSync(target).size : -1;
    if (cachedSize !== size) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      // Copy next to the target and rename, so an interrupted copy never leaves
      // a half-written runtime behind.
      const staging = `${target}.staging-${process.pid}`;
      fs.copyFileSync(installed, staging);
      fs.rmSync(target, { force: true });
      fs.renameSync(staging, target);
    }
    return target;
  } catch {
    // Relocation is best effort: fall back to the installed binary.
    return undefined;
  }
}

export function getWranglerEnv() {
  const runtime = process.env.MINIFLARE_WORKERD_PATH ? undefined : resolveWorkerdRuntime();
  return {
    ...process.env,
    ...(runtime ? { MINIFLARE_WORKERD_PATH: runtime } : {}),
  };
}
