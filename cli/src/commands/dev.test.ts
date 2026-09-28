import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { createViteCacheDir, createViteEnv } from "./dev";

const PROJECT = path.resolve("C:/projects/rin");

describe("createViteCacheDir", () => {
  it("keeps the cache inside the project so it is always writable", () => {
    const dir = createViteCacheDir(11499, PROJECT);
    expect(path.isAbsolute(dir)).toBe(true);
    expect(dir).toBe(path.join(PROJECT, ".vite", "rin-11499"));
    // A literal POSIX "/tmp/..." path is not portable to Windows.
    expect(dir.startsWith("/tmp")).toBe(false);
  });

  it("uses a distinct directory for the client-only entry point", () => {
    expect(createViteCacheDir(undefined, PROJECT)).toBe(path.join(PROJECT, ".vite", "rin-client"));
  });
});

describe("createViteEnv", () => {
  it("passes the cache dir and the internal worker port to Vite", () => {
    const env = createViteEnv(11499);
    expect(env.RIN_VITE_CACHE_DIR).toBe(createViteCacheDir(11499));
    expect(env.RIN_SERVER_PORT).toBe("11499");
  });

  it("omits the worker port when only the client runs", () => {
    const env = createViteEnv();
    expect(env.RIN_VITE_CACHE_DIR).toBe(createViteCacheDir());
    expect(env.RIN_SERVER_PORT).toBeUndefined();
  });

  it("honours an explicitly configured cache directory", () => {
    const previous = process.env.RIN_VITE_CACHE_DIR;
    process.env.RIN_VITE_CACHE_DIR = "E:\\code\\Rin\\.vite\\custom";
    try {
      expect(createViteEnv(11499).RIN_VITE_CACHE_DIR).toBe("E:\\code\\Rin\\.vite\\custom");
    } finally {
      if (previous === undefined) delete process.env.RIN_VITE_CACHE_DIR;
      else process.env.RIN_VITE_CACHE_DIR = previous;
    }
  });

  it("keeps the parent environment", () => {
    const env = createViteEnv() as Record<string, string | undefined>;
    const inherited = process.env as Record<string, string | undefined>;
    const dropped = Object.entries(inherited).filter(([key, value]) => env[key] !== value);
    expect(dropped).toEqual([]);
  });
});
