import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { logger } from "../util/logger.js";
import type { ScanSessionState } from "./sessionStore.js";

export async function buildPdf(session: ScanSessionState): Promise<string> {
  const entries = (await readdir(session.dir))
    .filter((f) => f.startsWith("page_") && f.endsWith(".jpg"))
    .sort();
  if (entries.length === 0) {
    throw new Error("no pages to assemble");
  }
  const pages = entries.map((f) => path.join(session.dir, f));
  const out = path.join(session.dir, "scan.pdf");
  logger.debug({ pages, out }, "img2pdf invocation");
  await runImg2pdf(pages, out);
  return out;
}

function runImg2pdf(pages: string[], outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("img2pdf", [...pages, "-o", outPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
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
            `img2pdf exited with code ${code}: ${stderr.trim() || "no stderr"}`,
          ),
        );
      }
    });
  });
}
