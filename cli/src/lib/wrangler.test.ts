import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  getWranglerEnv,
  isInsideDirectory,
  resolveInstalledWorkerd,
  resolveWorkerdRuntime,
  workerdCacheRoot,
} from "./wrangler";

describe("isInsideDirectory", () => {
  it("detects paths inside a directory", () => {
    expect(
      isInsideDirectory(path.join("C:/projects/rin", "node_modules/w.exe"), "C:/projects/rin"),
    ).toBe(true);
    expect(isInsideDirectory("C:/projects/other/w.exe", "C:/projects/rin")).toBe(false);
    expect(isInsideDirectory("C:/projects/rin", "C:/projects/rin")).toBe(false);
    // A sibling directory sharing the prefix must not count as inside.
    expect(isInsideDirectory("C:/projects/rin-other/w.exe", "C:/projects/rin")).toBe(false);
  });
});

describe("workerdCacheRoot", () => {
  it("never points inside the project and is absolute", () => {
    const root = workerdCacheRoot();
    expect(path.isAbsolute(root)).toBe(true);
    expect(root.endsWith(path.join("rin", "workerd"))).toBe(true);
  });
});

describe("resolveWorkerdRuntime", () => {
  it("returns nothing for a project that does not contain the runtime", () => {
    const installed = resolveInstalledWorkerd();
    if (process.platform !== "win32" || !installed) {
      expect(resolveWorkerdRuntime()).toBeUndefined();
      return;
    }
    expect(resolveWorkerdRuntime("C:/definitely/not/the/project")).toBeUndefined();
  });

  it("relocates the runtime out of the project on Windows", () => {
    const installed = resolveInstalledWorkerd();
    if (process.platform !== "win32" || !installed) {
      return;
    }
    const projectDir = path.dirname(path.dirname(installed));
    const relocated = resolveWorkerdRuntime(projectDir);
    expect(relocated).toBeDefined();
    expect(isInsideDirectory(relocated as string, projectDir)).toBe(false);
    expect(fs.existsSync(relocated as string)).toBe(true);
    expect(fs.statSync(relocated as string).size).toBe(fs.statSync(installed).size);
    // The cached copy is reused on the next call.
    expect(resolveWorkerdRuntime(projectDir) === relocated).toBe(true);
  });
});

describe("getWranglerEnv", () => {
  it("keeps the parent environment", () => {
    const env = getWranglerEnv() as Record<string, string | undefined>;
    const inherited = process.env as Record<string, string | undefined>;
    const dropped = Object.entries(inherited).filter(([key, value]) => env[key] !== value);
    expect(dropped).toEqual([]);
  });

  it("never overrides an explicitly configured runtime path", () => {
    const previous = process.env.MINIFLARE_WORKERD_PATH;
    process.env.MINIFLARE_WORKERD_PATH = "C:\\custom\\workerd.exe";
    try {
      expect(getWranglerEnv().MINIFLARE_WORKERD_PATH).toBe("C:\\custom\\workerd.exe");
    } finally {
      if (previous === undefined) delete process.env.MINIFLARE_WORKERD_PATH;
      else process.env.MINIFLARE_WORKERD_PATH = previous;
    }
  });

  it("points miniflare outside the project when the runtime lives inside it", () => {
    const installed = resolveInstalledWorkerd();
    if (process.platform !== "win32" || !installed) {
      return;
    }
    const projectDir = path.dirname(path.dirname(installed));
    const previousPath = process.env.MINIFLARE_WORKERD_PATH;
    const previousCwd = process.cwd();
    delete process.env.MINIFLARE_WORKERD_PATH;
    process.chdir(projectDir);
    try {
      const runtime = getWranglerEnv().MINIFLARE_WORKERD_PATH;
      expect(runtime).toBeDefined();
      expect(isInsideDirectory(runtime as string, projectDir)).toBe(false);
    } finally {
      process.chdir(previousCwd);
      if (previousPath !== undefined) process.env.MINIFLARE_WORKERD_PATH = previousPath;
    }
  });
});
