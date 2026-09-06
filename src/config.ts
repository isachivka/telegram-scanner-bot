import { z } from "zod";

export const LANGUAGES = ["en", "ru"] as const;
export type Language = (typeof LANGUAGES)[number];

export const SCAN_FORMATS = ["jpeg", "png"] as const;
export type ScanFormat = (typeof SCAN_FORMATS)[number];

const csv = (raw: string): string[] =>
  raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const intList = (name: string, fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((raw, ctx) => {
      const values = csv(raw).map((s) => {
        const n = Number(s);
        if (!Number.isInteger(n) || n <= 0) {
          ctx.addIssue({
            code: "custom",
            message: `${name} contains a non-positive integer: "${s}"`,
          });
        }
        return n;
      });
      if (values.length === 0) {
        ctx.addIssue({ code: "custom", message: `${name} must list at least one value` });
      }
      return values;
    });

const optionalString = z
  .string()
  .optional()
  .transform((s) => (s && s.trim() ? s.trim() : undefined));

const schema = z.object({
  TELEGRAM_BOT_TOKEN: optionalString,
  ALLOWED_USER_IDS: z
    .string()
    .default("")
    .transform((raw, ctx) =>
      csv(raw).map((s) => {
        const n = Number(s);
        if (!Number.isInteger(n)) {
          ctx.addIssue({
            code: "custom",
            message: `ALLOWED_USER_IDS contains a non-integer: "${s}"`,
          });
        }
        return n;
      }),
    ),
  ALLOWED_CHAT_IDS: z
    .string()
    .default("")
    .transform((raw, ctx) =>
      csv(raw).map((s) => {
        const n = Number(s);
        if (!Number.isInteger(n)) {
          ctx.addIssue({
            code: "custom",
            message: `ALLOWED_CHAT_IDS contains a non-integer: "${s}"`,
          });
        }
        return n;
      }),
    ),
  BOT_LANGUAGE: z.enum(LANGUAGES).default("en"),

  SCANNER_URL: optionalString,
  SCANNER_DEVICE: optionalString,
  SCAN_MODES: z.string().default("Color,Gray").transform(csv),
  SCAN_DEFAULT_MODE: optionalString,
  SCAN_DPI_OPTIONS: intList("SCAN_DPI_OPTIONS", "200,300,600"),
  SCAN_DEFAULT_DPI: z.coerce.number().int().positive().optional(),
  SCAN_SOURCE: optionalString,
  SCAN_ADF_SOURCE: optionalString,
  SCAN_FORMAT: z.enum(SCAN_FORMATS).default("jpeg"),
  SCANIMAGE_EXTRA_ARGS: z
    .string()
    .default("")
    .transform((raw) => raw.split(/\s+/).filter(Boolean)),
  SCAN_TIMEOUT_SEC: z.coerce.number().int().positive().default(180),
  SCAN_TMP_DIR: z.string().default("/tmp/scanner-bot"),

  PRINTER_QUEUE: optionalString,
  PRINT_COPIES_OPTIONS: intList("PRINT_COPIES_OPTIONS", "1,2,3,5,10"),
  PRINT_MAX_FILE_MB: z.coerce.number().positive().default(20),

  SCAN_OUTPUT_DIR: z.string().default("/data/scans"),

  MCP_HTTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  MCP_HTTP_HOST: z.string().default("0.0.0.0"),
  MCP_HTTP_PATH: z.string().default("/mcp"),
  MCP_AUTH_TOKEN: optionalString,
  PUBLIC_URL: optionalString,
  FILE_LINK_TTL_SEC: z.coerce
    .number()
    .int()
    .positive()
    .default(7 * 24 * 3600),
  UPLOAD_MAX_MB: z.coerce.number().positive().default(50),

  LOG_LEVEL: z.string().default("info"),
});

export interface Config {
  telegram?: {
    botToken: string;
    /** Users allowed anywhere (private chats and any group). */
    allowedUserIds: Set<number>;
    /** Group chats where every member may use the bot. */
    allowedChatIds: Set<number>;
    language: Language;
  };
  mcp: {
    /** Where MCP `scan` results are written so clients can pick them up. */
    outputDir: string;
    http?: {
      host: string;
      port: number;
      path: string;
      authToken: string;
      /** Base URL clients should use to reach this server (for links); derived from the Host header when unset. */
      publicUrl?: string;
      /** How long signed download links stay valid. */
      linkTtlMs: number;
      uploadMaxBytes: number;
    };
  };
  scanner: {
    /** eSCL/WSD URL; when set the container generates airscan.conf for it. */
    url?: string;
    /** SANE device name (`scanimage -d`). Undefined = let SANE pick the first device. */
    device?: string;
    modes: string[];
    defaultMode: string;
    dpiOptions: number[];
    defaultDpi: number;
    /** `--source` for single-page scans (e.g. Flatbed). */
    source?: string;
    /** `--source` used for "scan the whole feeder" batch runs (e.g. ADF). Enables the ADF button. */
    adfSource?: string;
    format: ScanFormat;
    extraArgs: string[];
    timeoutMs: number;
    tmpDir: string;
  };
  printer?: {
    queue: string;
    copiesOptions: number[];
    maxFileBytes: number;
  };
  logLevel: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map((i) => {
      const where = i.path.length ? `${i.path.join(".")}: ` : "";
      return `  - ${where}${i.message}`;
    });
    throw new ConfigError(`Invalid configuration:\n${lines.join("\n")}`);
  }
  const p = result.data;

  const modes = p.SCAN_MODES;
  const defaultMode = p.SCAN_DEFAULT_MODE ?? modes[0]!;
  if (!modes.includes(defaultMode)) {
    throw new ConfigError(
      `SCAN_DEFAULT_MODE "${defaultMode}" is not one of SCAN_MODES (${modes.join(", ")})`,
    );
  }
  const dpiOptions = p.SCAN_DPI_OPTIONS;
  const defaultDpi =
    p.SCAN_DEFAULT_DPI ?? (dpiOptions.includes(300) ? 300 : dpiOptions[0]!);
  if (!dpiOptions.includes(defaultDpi)) {
    throw new ConfigError(
      `SCAN_DEFAULT_DPI ${defaultDpi} is not one of SCAN_DPI_OPTIONS (${dpiOptions.join(", ")})`,
    );
  }

  let device = p.SCANNER_DEVICE;
  if (!device && p.SCANNER_URL) {
    device = "airscan:e0:Scanner";
  }

  if (p.MCP_HTTP_PORT !== undefined && !p.MCP_AUTH_TOKEN) {
    throw new ConfigError(
      "MCP_AUTH_TOKEN is required when MCP_HTTP_PORT is set (the MCP endpoint would be open to anyone on the network)",
    );
  }
  if (p.MCP_AUTH_TOKEN && p.MCP_AUTH_TOKEN.length < 16) {
    throw new ConfigError("MCP_AUTH_TOKEN must be at least 16 characters");
  }
  if (!p.MCP_HTTP_PATH.startsWith("/")) {
    throw new ConfigError("MCP_HTTP_PATH must start with /");
  }
  if (p.PUBLIC_URL && !/^https?:\/\//.test(p.PUBLIC_URL)) {
    throw new ConfigError("PUBLIC_URL must start with http:// or https://");
  }

  return {
    telegram: p.TELEGRAM_BOT_TOKEN
      ? {
          botToken: p.TELEGRAM_BOT_TOKEN,
          allowedUserIds: new Set(p.ALLOWED_USER_IDS),
          allowedChatIds: new Set(p.ALLOWED_CHAT_IDS),
          language: p.BOT_LANGUAGE,
        }
      : undefined,
    mcp: {
      outputDir: p.SCAN_OUTPUT_DIR,
      http:
        p.MCP_HTTP_PORT !== undefined
          ? {
              host: p.MCP_HTTP_HOST,
              port: p.MCP_HTTP_PORT,
              path: p.MCP_HTTP_PATH,
              authToken: p.MCP_AUTH_TOKEN!,
              publicUrl: p.PUBLIC_URL?.replace(/\/+$/, ""),
              linkTtlMs: p.FILE_LINK_TTL_SEC * 1000,
              uploadMaxBytes: Math.round(p.UPLOAD_MAX_MB * 1024 * 1024),
            }
          : undefined,
    },
    scanner: {
      url: p.SCANNER_URL,
      device,
      modes,
      defaultMode,
      dpiOptions,
      defaultDpi,
      source: p.SCAN_SOURCE,
      adfSource: p.SCAN_ADF_SOURCE,
      format: p.SCAN_FORMAT,
      extraArgs: p.SCANIMAGE_EXTRA_ARGS,
      timeoutMs: p.SCAN_TIMEOUT_SEC * 1000,
      tmpDir: p.SCAN_TMP_DIR,
    },
    printer: p.PRINTER_QUEUE
      ? {
          queue: p.PRINTER_QUEUE,
          copiesOptions: p.PRINT_COPIES_OPTIONS,
          maxFileBytes: Math.round(p.PRINT_MAX_FILE_MB * 1024 * 1024),
        }
      : undefined,
    logLevel: p.LOG_LEVEL,
  };
}

/** Config with secrets masked, safe for logs. */
export function describeConfig(c: Config): Record<string, unknown> {
  return {
    telegram: c.telegram
      ? {
          language: c.telegram.language,
          allowedUserIds: [...c.telegram.allowedUserIds],
          allowedChatIds: [...c.telegram.allowedChatIds],
        }
      : undefined,
    mcp: {
      outputDir: c.mcp.outputDir,
      http: c.mcp.http ? { ...c.mcp.http, authToken: "***" } : undefined,
    },
    scanner: c.scanner,
    printer: c.printer,
    logLevel: c.logLevel,
  };
}
