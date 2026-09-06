import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, type Config } from "../src/config.js";
import { createServices, type Services } from "../src/core/services.js";
import { nullLogger } from "../src/util/logger.js";

export const FAKEBIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "fakebin");

export interface Sandbox {
  dir: string;
  logFile: string;
  services: Services;
  config: Config;
  /** Lines the fake binaries appended (one per invocation). */
  calls(): Promise<string[]>;
  cleanup(): Promise<void>;
}

const originalPath = process.env.PATH ?? "";

export function baseEnv(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return {
    TELEGRAM_BOT_TOKEN: "123456:TEST-TOKEN",
    ALLOWED_USER_IDS: "1001",
    SCANNER_URL: "http://192.0.2.10/eSCL",
    PRINTER_QUEUE: "FakeQueue",
    SCAN_ADF_SOURCE: "ADF",
    LOG_LEVEL: "silent",
    ...overrides,
  };
}

/** Puts the fake binaries first on PATH and points every tmp dir into a sandbox. */
export async function createSandbox(
  overrides: Record<string, string | undefined> = {},
): Promise<Sandbox> {
  const dir = await mkdtemp(path.join(tmpdir(), "scanner-bot-test-"));
  const logFile = path.join(dir, "calls.log");
  process.env.PATH = `${FAKEBIN}:${originalPath}`;
  process.env.FAKE_LOG = logFile;
  const config = loadConfig(
    baseEnv({
      SCAN_TMP_DIR: path.join(dir, "tmp"),
      SCAN_OUTPUT_DIR: path.join(dir, "scans"),
      ...overrides,
    }),
  );
  const services = createServices(config, nullLogger);
  await services.sessions.sweep();
  return {
    dir,
    logFile,
    services,
    config,
    calls: async () => {
      try {
        return (await readFile(logFile, "utf8")).trim().split("\n").filter(Boolean);
      } catch {
        return [];
      }
    },
    cleanup: async () => {
      process.env.PATH = originalPath;
      delete process.env.FAKE_LOG;
      delete process.env.FAKE_SCAN_FAIL;
      delete process.env.FAKE_ADF_PAGES;
      delete process.env.FAKE_ADF_EXIT7;
      delete process.env.FAKE_LP_FAIL;
      delete process.env.FAKE_SCAN_SLEEP;
      await rm(dir, { recursive: true, force: true });
    },
  };
}
