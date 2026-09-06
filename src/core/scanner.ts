import { readdir } from "node:fs/promises";
import path from "node:path";
import { Mutex } from "async-mutex";
import type { Config, ScanFormat } from "../config.js";
import type { Logger } from "../util/logger.js";
import { exec, ExecError } from "../util/exec.js";

export interface ScanOptions {
  mode: string;
  dpi: number;
}

export interface FeederResult {
  /** Paths of the pages that were produced, in scan order. */
  pages: string[];
}

export interface SaneDevice {
  name: string;
  description: string;
}

/** SANE_STATUS_NO_DOCS: scanimage returns 7 when an ADF runs dry in batch mode. */
const SANE_STATUS_NO_DOCS = 7;

export class ScannerBusyError extends Error {
  constructor() {
    super("scanner is busy");
    this.name = "ScannerBusyError";
  }
}

/**
 * Wraps `scanimage`. One scan at a time: physical scanners do not multiplex,
 * and the Telegram bot and the MCP server share this instance.
 */
export class Scanner {
  private readonly lock = new Mutex();

  constructor(
    private readonly cfg: Config["scanner"],
    private readonly log: Logger,
  ) {}

  get format(): ScanFormat {
    return this.cfg.format;
  }

  get extension(): string {
    return this.cfg.format === "jpeg" ? "jpg" : "png";
  }

  isBusy(): boolean {
    return this.lock.isLocked();
  }

  /** Scan a single page into `outPath`. */
  async scanPage(outPath: string, opts: ScanOptions): Promise<void> {
    await this.lock.runExclusive(async () => {
      const args = [
        ...this.baseArgs(opts),
        ...(this.cfg.source ? [`--source=${this.cfg.source}`] : []),
        `--output-file=${outPath}`,
      ];
      this.log.debug({ args }, "scanimage");
      await exec("scanimage", args, { timeoutMs: this.cfg.timeoutMs });
    });
  }

  /**
   * Scan every sheet in the document feeder into `dir`, numbering pages from
   * `startPage`. Returns the pages that were produced (possibly none).
   */
  async scanFeeder(
    dir: string,
    startPage: number,
    opts: ScanOptions,
  ): Promise<FeederResult> {
    if (!this.cfg.adfSource) {
      throw new Error("SCAN_ADF_SOURCE is not configured");
    }
    return this.lock.runExclusive(async () => {
      const pattern = path.join(dir, `page_%03d.${this.extension}`);
      const args = [
        ...this.baseArgs(opts),
        `--source=${this.cfg.adfSource}`,
        `--batch=${pattern}`,
        `--batch-start=${startPage}`,
      ];
      this.log.debug({ args }, "scanimage batch");
      // Batch runs are bounded by pages × timeout; allow a generous multiple.
      await exec("scanimage", args, {
        timeoutMs: this.cfg.timeoutMs * 10,
        okCodes: [SANE_STATUS_NO_DOCS],
      });
      const produced = (await readdir(dir))
        .filter((f) => /^page_\d{3}\./.test(f))
        .map((f) => ({ f, n: Number(f.slice(5, 8)) }))
        .filter(({ n }) => n >= startPage)
        .sort((a, b) => a.n - b.n)
        .map(({ f }) => path.join(dir, f));
      return { pages: produced };
    });
  }

  /** `scanimage -L`, parsed. */
  async listDevices(): Promise<SaneDevice[]> {
    const { stdout } = await exec("scanimage", ["-L"], { timeoutMs: 30_000 });
    return parseDeviceList(stdout);
  }

  private baseArgs(opts: ScanOptions): string[] {
    return [
      ...(this.cfg.device ? [`--device-name=${this.cfg.device}`] : []),
      `--mode=${opts.mode}`,
      `--resolution=${opts.dpi}`,
      `--format=${this.cfg.format}`,
      ...this.cfg.extraArgs,
    ];
  }
}

export function parseDeviceList(stdout: string): SaneDevice[] {
  const devices: SaneDevice[] = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(/^device `([^']+)' is a (.+)$/);
    if (m) devices.push({ name: m[1]!, description: m[2]!.trim() });
  }
  return devices;
}

export function isNoDocsError(err: unknown): boolean {
  return err instanceof ExecError && err.result.code === SANE_STATUS_NO_DOCS;
}
