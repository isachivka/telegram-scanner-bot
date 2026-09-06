import type { Config } from "../config.js";
import type { Logger } from "../util/logger.js";
import { exec } from "../util/exec.js";

export interface PrintOptions {
  copies: number;
}

export interface PrintJob {
  jobId: string;
}

/** Wraps `lp` / `lpstat` from cups-client against the configured queue. */
export class Printer {
  constructor(
    private readonly cfg: NonNullable<Config["printer"]>,
    private readonly log: Logger,
  ) {}

  get queue(): string {
    return this.cfg.queue;
  }

  get copiesOptions(): number[] {
    return this.cfg.copiesOptions;
  }

  get maxFileBytes(): number {
    return this.cfg.maxFileBytes;
  }

  async print(filePath: string, opts: PrintOptions): Promise<PrintJob> {
    const args = ["-d", this.cfg.queue, "-n", String(opts.copies), "--", filePath];
    this.log.debug({ args }, "lp");
    const { stdout } = await exec("lp", args, { timeoutMs: 60_000 });
    const match = stdout.match(/request id is (\S+)/);
    return { jobId: match?.[1] ?? stdout.trim() };
  }

  /** One-line printer state from `lpstat -p <queue>`. */
  async status(): Promise<string> {
    const { stdout } = await exec("lpstat", ["-p", this.cfg.queue], {
      timeoutMs: 30_000,
    });
    return stdout.trim().split("\n")[0] ?? "";
  }
}
