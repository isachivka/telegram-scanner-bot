import pino, { type Logger } from "pino";

export type { Logger };

export function createLogger(level: string): Logger {
  const pretty = process.env.NODE_ENV !== "production" && process.stdout.isTTY;
  return pino({
    level,
    ...(pretty
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
          },
        }
      : {}),
  });
}

/** Silent logger for tests and `--check`. */
export const nullLogger: Logger = pino({ level: "silent" });
