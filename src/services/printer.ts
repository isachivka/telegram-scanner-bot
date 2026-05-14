import { spawn } from "node:child_process";
import { config } from "../config.js";
import { logger } from "../util/logger.js";

export interface PrintOptions {
  copies: number;
}

export interface PrintResult {
  jobId: string;
}

export async function printPdf(
  filePath: string,
  opts: PrintOptions,
): Promise<PrintResult> {
  const cliArgs = [
    "-d",
    config.printerQueue,
    "-n",
    String(opts.copies),
    "--",
    filePath,
  ];
  logger.debug({ cliArgs }, "lp invocation");
  const stdout = await runLp(cliArgs);
  const match = stdout.match(/request id is (\S+)/);
  const jobId = match ? match[1] : stdout.trim();
  return { jobId };
}

function runLp(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("lp", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(
          new Error(
            `lp exited with code ${code}: ${stderr.trim() || stdout.trim() || "no output"}`,
          ),
        );
      }
    });
  });
}
