import { z } from "zod";

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  ALLOWED_USER_IDS: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => {
          const n = Number(x);
          if (!Number.isInteger(n)) {
            throw new Error(`ALLOWED_USER_IDS contains non-integer value: ${x}`);
          }
          return n;
        }),
    ),
  SCANNER_DEVICE: z.string().min(1),
  LOG_LEVEL: z.string().default("info"),
});

const parsed = schema.parse(process.env);

export const config = {
  botToken: parsed.TELEGRAM_BOT_TOKEN,
  allowedUserIds: new Set(parsed.ALLOWED_USER_IDS),
  scannerDevice: parsed.SCANNER_DEVICE,
  logLevel: parsed.LOG_LEVEL,
};
