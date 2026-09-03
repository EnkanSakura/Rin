import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { visualizer } from "rollup-plugin-visualizer";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isDev = mode === 'development';
  const serverPort = Number(process.env.RIN_SERVER_PORT || "11499");
  const serverTarget = `http://127.0.0.1:${serverPort}`;
  const cacheDir = process.env.RIN_VITE_CACHE_DIR || "../.vite/client";

  /**
   * Dev-only passthrough for domain-verification TXT files.
   *
   * The Vite proxy table only forwards known routes (/api, /rss.xml, ...).
   * Verification files live at arbitrary "*.txt" paths (e.g. /google123.txt,
   * /.well-known/google123.txt) and are served by the Worker from D1, so in
   * dev we forward candidate TXT requests to the internal Worker port, unless
   * a real static file exists in the Vite `public` dir (e.g. /robots.txt).
   * When the Worker does not answer with plain text (no D1 row, error, ...)
   * we fall through to the regular Vite pipeline (SPA index) as before.
   * Production does not need this: `run_worker_first` sends every request to
   * the Worker, which resolves TXT paths against D1 itself.
   */
  function verificationTxtPassthrough(): Plugin {
    return {
      name: "rin-verification-txt-passthrough",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.method !== "GET" && req.method !== "HEAD") return next();
          const pathname = (req.url ?? "").split("?")[0];
          if (!pathname.endsWith(".txt")) return next();
          if (existsInPublicDir(server, pathname)) return next();

          try {
            const upstream = await fetch(serverTarget + (req.url ?? ""));
            if (!upstream.ok) return next();
            const contentType = upstream.headers.get("content-type") ?? "";
            if (!contentType.includes("text/plain")) return next();

            // Only forward the essential headers: the upstream body is fully
            // decoded by fetch(), so re-emitting content-encoding/content-length
            // would corrupt the response for the browser.
            const body = req.method === "HEAD" ? "" : await upstream.text();
            res.writeHead(upstream.status, {
              "Content-Type": contentType,
              "Cache-Control": "no-store",
            });
            res.end(body);
          } catch {
            // Fall through to the regular Vite pipeline (SPA index) on any error.
            next();
          }
        });
      },
    };
  }

  function existsInPublicDir(server: ViteDevServer, pathname: string) {
    const publicDir = server.config.publicDir;
    if (!publicDir) return false;
    try {
      const decoded = decodeURIComponent(pathname);
      if (decoded.includes("\0")) return false;
      const root = resolve(publicDir);
      const candidate = resolve(root, `.${decoded}`);
      return candidate.startsWith(root) && existsSync(candidate) && statSync(candidate).isFile();
    } catch {
      return false;
    }
  }

  return {
    cacheDir,
    // Note: Client configuration is fetched from server at runtime
    // No environment variables are injected at build time
    build: {
      outDir: '../dist/client',
      emptyOutDir: true,
    },
    plugins: [
      react(),
      // Only open visualizer in build mode
      visualizer({ open: !isDev }),
      verificationTxtPassthrough(),
    ],
    server: {
      proxy: {
        "/api": {
          target: serverTarget,
          changeOrigin: false,
        },
        "/rss.xml": {
          target: serverTarget,
          changeOrigin: false,
        },
        "/atom.xml": {
          target: serverTarget,
          changeOrigin: false,
        },
        "/rss.json": {
          target: serverTarget,
          changeOrigin: false,
        },
        "/feed.json": {
          target: serverTarget,
          changeOrigin: false,
        },
        "/feed.xml": {
          target: serverTarget,
          changeOrigin: false,
        },
      },
    },
    // Vitest configuration
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      css: true,
    },
  }
})
