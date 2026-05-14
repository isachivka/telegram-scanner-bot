import { spawn } from "node:child_process";
import { Mutex } from "async-mutex";
import { config } from "../config.js";
import { logger } from "../util/logger.js";
import {
  pagePath,
  type ScanSessionState,
} from "./sessionStore.js";

const lock = new Mutex();

export type ScanMode = "Color" | "Gray";
export type ScanDpi = 200 | 300 | 600;

export interface ScanOptions {
  mode: ScanMode;
  dpi: ScanDpi;
}

export function isBusy(): boolean {
  return lock.isLocked();
}

export async function scanOne(
  session: ScanSessionState,
  pageNo: number,
  opts: ScanOptions,
): Promise<string> {
  return lock.runExclusive(async () => {
    const out = pagePath(session, pageNo);
    await runScanimage({
      device: config.scannerDevice,
      mode: opts.mode,
      dpi: opts.dpi,
      outPath: out,
    });
    return out;
  });
}

interface RunArgs {
  device: string;
  mode: ScanMode;
  dpi: ScanDpi;
  outPath: string;
}

function runScanimage(args: RunArgs): Promise<void> {
  const cliArgs = [
    `--device-name=${args.device}`,
    `--mode=${args.mode}`,
    `--resolution=${args.dpi}`,
    "--format=jpeg",
    `--output-file=${args.outPath}`,
  ];
  logger.debug({ cliArgs }, "scanimage invocation");
  return new Promise((resolve, reject) => {
    const proc = spawn("scanimage", cliArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `scanimage exited with code ${code}: ${stderr.trim() || "no stderr"}`,
          ),
        );
      }
    });
  });
}
