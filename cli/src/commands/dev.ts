import type { Subprocess } from "bun";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { parseEnv } from "../lib/env";
import { startDevFetchRelay, type DevFetchRelay } from "../lib/dev-proxy";
import { logger } from "../lib/logger";
import { checkPort } from "../lib/network";
import { getWranglerEnv } from "../lib/wrangler";
import { runLocalDbMigrate } from "../tasks/db-migrate-local";
import { runSetupDev } from "../tasks/setup-dev";

const bunExec = process.execPath;
/** Offset from the Vite port; the Worker port uses +1. */
const RELAY_PORT_OFFSET = 2;

function registerSignalHandlers(processes: Subprocess[]) {
  const stopAll = () => {
    for (const child of processes) {
      child.kill("SIGTERM");
    }
  };

  process.on("SIGINT", stopAll);
  process.on("SIGTERM", stopAll);
}

function createViteArgs(port: number) {
  return [bunExec, "x", "vite", "--host", "0.0.0.0", "--port", String(port), "--strictPort"];
}

function createWranglerArgs(port: number) {
  return [bunExec, "x", "wrangler", "dev", "--port", String(port), "--test-scheduled"];
}

function createViteEnv(serverPort?: number) {
  return {
    ...process.env,
    RIN_VITE_CACHE_DIR: `/tmp/rin-vite-cache-${serverPort ?? "client"}`,
    ...(serverPort ? { RIN_SERVER_PORT: String(serverPort) } : {}),
  };
}

/**
 * Reads the optional outbound proxy (from the shell or `.env.local`, which Bun
 * loads automatically) and, when present, starts the loopback relay the Worker
 * uses for its outbound fetches.
 */
async function startRelayFromEnv(port: number): Promise<DevFetchRelay | null> {
  const fromProcess = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY || "";
  let proxy = fromProcess;

  if (!proxy) {
    const envFile = path.join(process.cwd(), ".env.local");
    if (fs.existsSync(envFile)) {
      const env = parseEnv(fs.readFileSync(envFile, "utf-8"));
      proxy = env.HTTPS_PROXY || env.HTTP_PROXY || env.ALL_PROXY || "";
    }
  }

  if (!proxy) {
    return null;
  }

  const relayPort = port + RELAY_PORT_OFFSET;
  if (!(await checkPort(relayPort))) {
    logger.warn(`Dev proxy relay port ${relayPort} is in use, outbound proxy disabled`);
    return null;
  }

  const relay = startDevFetchRelay({ port: relayPort, proxy });
  logger.info(`Outbound proxy ${proxy} enabled via ${relay.url}`);
  return relay;
}

export async function runDevCommand(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      port: { type: "string", short: "p", default: "11498" },
      client: { type: "boolean", default: false },
      server: { type: "boolean", default: false },
    },
    strict: false,
  });

  const port = parseInt((values.port as string) || "11498");
  if (!(await checkPort(port))) {
    throw new Error(`Port ${port} is already in use`);
  }

  const workerPort = port + 1;
  if (!values.client && !values.server && !(await checkPort(workerPort))) {
    throw new Error(`Internal worker port ${workerPort} is already in use`);
  }

  const relay = values.client ? null : await startRelayFromEnv(port);

  await runSetupDev({ devFetchRelay: relay?.url });

  if (!values.client) {
    logger.info("Checking database migrations...");
    await runLocalDbMigrate();
    logger.success("Database migrations completed");
  }

  if (values.client) {
    const proc = Bun.spawn(createViteArgs(port), {
      stdout: "inherit",
      stderr: "inherit",
      cwd: "client",
      env: createViteEnv(),
    });
    registerSignalHandlers([proc]);
    await proc.exited;
    return;
  }

  if (values.server) {
    const proc = Bun.spawn(createWranglerArgs(port), {
      stdout: "inherit",
      stderr: "inherit",
      cwd: "server",
      env: getWranglerEnv(),
    });
    registerSignalHandlers([proc]);
    await proc.exited;
    relay?.stop();
    return;
  }

  logger.info(`Starting worker on internal port ${workerPort}...`);
  const workerProc = Bun.spawn(createWranglerArgs(workerPort), {
    stdout: "inherit",
    stderr: "inherit",
    cwd: "server",
    env: getWranglerEnv(),
  });

  logger.info(`Starting Vite dev server with HMR on port ${port}...`);
  const clientProc = Bun.spawn(createViteArgs(port), {
    stdout: "inherit",
    stderr: "inherit",
    cwd: "client",
    env: createViteEnv(workerPort),
  });

  logger.success(`Development entry is http://localhost:${port} (API proxied to ${workerPort})`);
  registerSignalHandlers([workerProc, clientProc]);

  const exitCode = await Promise.race([workerProc.exited, clientProc.exited]);
  workerProc.kill("SIGTERM");
  clientProc.kill("SIGTERM");
  relay?.stop();
  if (exitCode !== 0) {
    throw new Error("Development server exited unexpectedly");
  }
}
