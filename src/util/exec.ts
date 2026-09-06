import { spawn } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
}

export class ExecError extends Error {
  constructor(
    public readonly command: string,
    public readonly result: ExecResult,
  ) {
    const detail = result.stderr.trim() || result.stdout.trim() || "no output";
    const how =
      result.signal !== null
        ? `was killed by ${result.signal}`
        : `exited with code ${result.code ?? "unknown"}`;
    super(`${command} ${how}: ${detail}`);
    this.name = "ExecError";
  }
}

export interface ExecOptions {
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  /** Exit codes other than 0 that count as success. */
  okCodes?: number[];
}

/**
 * Run a binary without a shell, capture stdout/stderr, and reject with an
 * ExecError carrying both streams when it fails or times out.
 */
export function exec(
  command: string,
  args: string[],
  opts: ExecOptions = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...opts.env },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          proc.kill("SIGKILL");
        }, opts.timeoutMs)
      : undefined;

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(new Error(`${command}: ${err.message}`));
    });
    proc.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      const result: ExecResult = { stdout, stderr, code, signal };
      if (timedOut) {
        result.stderr = `${stderr}\ntimed out after ${opts.timeoutMs} ms`.trim();
        reject(new ExecError(command, result));
        return;
      }
      const ok = code === 0 || (code !== null && (opts.okCodes ?? []).includes(code));
      if (ok) resolve(result);
      else reject(new ExecError(command, result));
    });
  });
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
