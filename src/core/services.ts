import path from "node:path";
import type { Config } from "../config.js";
import type { Logger } from "../util/logger.js";
import { Printer } from "./printer.js";
import { Scanner } from "./scanner.js";
import { SessionStore } from "./sessions.js";

export interface Services {
  config: Config;
  log: Logger;
  scanner: Scanner;
  printer?: Printer;
  sessions: SessionStore;
}

export function createServices(config: Config, log: Logger): Services {
  return {
    config,
    log,
    scanner: new Scanner(config.scanner, log.child({ component: "scanner" })),
    printer: config.printer
      ? new Printer(config.printer, log.child({ component: "printer" }))
      : undefined,
    sessions: new SessionStore(path.join(config.scanner.tmpDir, "sessions")),
  };
}

export function scanFileName(extension = "pdf", now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `scan-${stamp}.${extension}`;
}
