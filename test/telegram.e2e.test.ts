import type { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBot } from "../src/telegram/bot.js";
import type { BotContext } from "../src/telegram/context.js";
import { createSandbox, type Sandbox } from "./helpers.js";

const ME: UserFromGetMe = {
  id: 123456,
  is_bot: true,
  first_name: "Scanner",
  username: "scanner_test_bot",
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};
const USER = { id: 1001, is_bot: false, first_name: "Igor" };
const CHAT = { id: 1001, type: "private" as const, first_name: "Igor" };

interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
}

async function readBody(body: BodyInit | null | undefined): Promise<string> {
  if (body == null) return "";
  if (typeof body === "string") return body;
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("latin1");
}

/** Turn a grammY request (JSON or multipart) into the payload the bot sent. */
async function parseRequest(
  init: RequestInit | undefined,
): Promise<Record<string, unknown>> {
  const contentType = String(new Headers(init?.headers).get("content-type") ?? "");
  const raw = await readBody(init?.body as BodyInit);
  if (contentType.includes("application/json")) return JSON.parse(raw || "{}");
  // Multipart: text fields as-is; `attach://<id>` references resolved to the
  // filename of the matching file part.
  const fields = new Map<string, string>();
  const files = new Map<string, string>();
  for (const part of raw.split(/------[^\r\n]+\r\n/).slice(1)) {
    const name = part.match(/name="([^"]+)"/)?.[1];
    if (!name) continue;
    const filename = part.match(/filename=([^\r\n;]+)/)?.[1];
    if (filename) {
      files.set(name, filename.replace(/^"|"$/g, ""));
    } else {
      fields.set(name, part.split("\r\n\r\n")[1]?.replace(/\r\n$/, "") ?? "");
    }
  }
  const payload: Record<string, unknown> = {};
  for (const [name, value] of fields) {
    const attach = value.match(/^attach:\/\/(.+)$/)?.[1];
    if (attach) {
      payload[name] = { filename: files.get(attach) };
      continue;
    }
    try {
      payload[name] = JSON.parse(value);
    } catch {
      payload[name] = value;
    }
  }
  return payload;
}

/** Bot wired to an in-memory Telegram API that records every call. */
function harness(sb: Sandbox, opts: { fetchImpl?: typeof fetch } = {}) {
  const calls: ApiCall[] = [];
  let nextMessageId = 100;
  let nextUpdateId = 1;
  const fakeTelegram: typeof fetch = async (input, init) => {
    const method = String(input).split("/").at(-1)!;
    const payload = await parseRequest(init);
    calls.push({ method, payload });
    let result: unknown;
    switch (method) {
      case "sendMessage":
      case "sendDocument":
        result = {
          message_id: nextMessageId++,
          date: 0,
          chat: CHAT,
          text: payload.text ?? "",
        };
        break;
      case "editMessageText":
        result = {
          message_id: payload.message_id,
          date: 0,
          chat: CHAT,
          text: payload.text,
        };
        break;
      case "editMessageReplyMarkup":
      case "answerCallbackQuery":
        result = true;
        break;
      case "getFile":
        result = {
          file_id: payload.file_id,
          file_path: `documents/${payload.file_id}.bin`,
        };
        break;
      default:
        throw new Error(`unexpected api method in test: ${method}`);
    }
    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const bot: Bot<BotContext> = createBot(sb.services, {
    botConfig: { botInfo: ME, client: { fetch: fakeTelegram } },
    download: { apiRoot: "http://telegram.test", fetchImpl: opts.fetchImpl },
  });

  const text = (t: string) =>
    bot.handleUpdate({
      update_id: nextUpdateId++,
      message: {
        message_id: nextMessageId++,
        date: 0,
        chat: CHAT,
        from: USER,
        text: t,
        entities: t.startsWith("/")
          ? [{ type: "bot_command", offset: 0, length: t.length }]
          : [],
      },
    } as Update);
  const press = (data: string, messageId = 100) =>
    bot.handleUpdate({
      update_id: nextUpdateId++,
      callback_query: {
        id: String(nextUpdateId),
        from: USER,
        chat_instance: "x",
        data,
        message: { message_id: messageId, date: 0, chat: CHAT, text: "" },
      },
    } as Update);
  const document = (doc: {
    file_id: string;
    file_name: string;
    mime_type: string;
    file_size?: number;
  }) =>
    bot.handleUpdate({
      update_id: nextUpdateId++,
      message: {
        message_id: nextMessageId++,
        date: 0,
        chat: CHAT,
        from: USER,
        document: doc,
      },
    } as Update);
  const photo = () =>
    bot.handleUpdate({
      update_id: nextUpdateId++,
      message: {
        message_id: nextMessageId++,
        date: 0,
        chat: CHAT,
        from: USER,
        photo: [
          { file_id: "small", file_unique_id: "s", width: 90, height: 90 },
          { file_id: "big", file_unique_id: "b", width: 1280, height: 960 },
        ],
      },
    } as Update);

  const last = (method: string) => calls.filter((c) => c.method === method).at(-1);
  const buttons = (call: ApiCall | undefined): string[] => {
    const markup = call?.payload.reply_markup as
      { inline_keyboard?: { text: string }[][] } | undefined;
    return markup?.inline_keyboard?.flat().map((b) => b.text) ?? [];
  };
  return { bot, calls, text, press, document, photo, last, buttons };
}

let sb: Sandbox;
beforeEach(async () => {
  sb = await createSandbox();
});
afterEach(() => sb.cleanup());

describe("telegram bot", () => {
  it("rejects strangers with their user id", async () => {
    const h = harness(sb);
    await h.bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: 0,
        chat: { id: 555, type: "private", first_name: "X" },
        from: { id: 555, is_bot: false, first_name: "X" },
        text: "/start",
        entities: [{ type: "bot_command", offset: 0, length: 6 }],
      },
    } as Update);
    expect(h.calls.map((c) => c.method)).toEqual(["sendMessage"]);
    expect(h.last("sendMessage")?.payload.text).toMatch(/Access denied.*555/s);
  });

  it("shows the main menu with scan and print buttons", async () => {
    const h = harness(sb);
    await h.text("/start");
    expect(h.buttons(h.last("sendMessage"))).toEqual(["📄 Scan", "🖨 Print"]);
  });

  it("hides the print button when no printer is configured", async () => {
    await sb.cleanup();
    sb = await createSandbox({ PRINTER_QUEUE: undefined });
    const h = harness(sb);
    await h.text("/start");
    expect(h.buttons(h.last("sendMessage"))).toEqual(["📄 Scan"]);
  });

  it("speaks Russian when asked", async () => {
    await sb.cleanup();
    sb = await createSandbox({ BOT_LANGUAGE: "ru" });
    const h = harness(sb);
    await h.text("/start");
    expect(h.last("sendMessage")?.payload.text).toMatch(/Привет/);
    expect(h.buttons(h.last("sendMessage"))).toEqual(["📄 Сканировать", "🖨 Печать"]);
  });

  it("scans two pages, cycles settings, and delivers a PDF", async () => {
    const h = harness(sb);
    await h.text("/start");
    await h.press("main:scan");
    const menu = h.last("sendMessage");
    expect(menu?.payload.text).toBe("Scan session\nMode: Color\nDPI: 300\nPages: 0");
    expect(h.buttons(menu)).toEqual([
      "➕ Scan page",
      "📚 Scan feeder",
      "🎨 Color",
      "🔍 300 dpi",
      "✅ Finish",
      "❌ Cancel",
    ]);
    await h.press("scan:mode");
    await h.press("scan:dpi");
    let edit = h.last("editMessageText");
    expect(edit?.payload.text).toBe("Scan session\nMode: Gray\nDPI: 600\nPages: 0");

    await h.press("scan:page");
    edit = h.last("editMessageText");
    expect(edit?.payload.text).toBe(
      "Done, pages scanned: 1\n\nScan session\nMode: Gray\nDPI: 600\nPages: 1",
    );
    await h.press("scan:page");
    expect(h.last("editMessageText")?.payload.text).toMatch(/Pages: 2$/);

    await h.press("scan:finish");
    const sent = h.last("sendDocument");
    expect(sent).toBeDefined();
    expect((sent!.payload.document as { filename: string }).filename).toMatch(
      /^scan-\d{8}-\d{6}\.pdf$/,
    );
    expect(sent!.payload.caption).toBe("Done, 2 page(s).");
    expect(h.last("editMessageText")?.payload.text).toBe("Main menu");
    expect(h.buttons(h.last("editMessageText"))).toEqual(["📄 Scan", "🖨 Print"]);

    const scans = (await sb.calls()).filter((c) => c.startsWith("scanimage"));
    expect(scans).toHaveLength(2);
    expect(scans[0]).toMatch(
      /--mode=Gray --resolution=600 --format=jpeg --output-file=.*page_001\.jpg$/,
    );
    expect(scans[1]).toMatch(/page_002\.jpg$/);
    expect((await sb.calls()).find((c) => c.startsWith("img2pdf"))).toMatch(
      /img2pdf .*page_001\.jpg .*page_002\.jpg -o .*scan\.pdf$/,
    );
    expect(sb.services.sessions.size).toBe(0);
  });

  it("scans the whole feeder in one press", async () => {
    process.env.FAKE_ADF_PAGES = "3";
    process.env.FAKE_ADF_EXIT7 = "1";
    const h = harness(sb);
    await h.text("/start");
    await h.press("main:scan");
    await h.press("scan:adf");
    expect(h.last("editMessageText")?.payload.text).toMatch(
      /^Done, 3 page\(s\) from the feeder, total: 3/,
    );
    await h.press("scan:finish");
    expect(h.last("sendDocument")?.payload.caption).toBe("Done, 3 page(s).");
  });

  it("tells the user when the feeder is empty", async () => {
    process.env.FAKE_ADF_PAGES = "0";
    process.env.FAKE_ADF_EXIT7 = "1";
    const h = harness(sb);
    await h.text("/start");
    await h.press("main:scan");
    await h.press("scan:adf");
    expect(h.last("editMessageText")?.payload.text).toMatch(/^The feeder is empty\./);
  });

  it("refuses to finish with zero pages and reports scan errors", async () => {
    const h = harness(sb);
    await h.text("/start");
    await h.press("main:scan");
    await h.press("scan:finish");
    expect(h.last("answerCallbackQuery")?.payload).toMatchObject({
      text: "No pages yet. Scan at least one first.",
      show_alert: true,
    });

    process.env.FAKE_SCAN_FAIL = "1";
    await h.press("scan:page");
    expect(h.last("editMessageText")?.payload.text).toMatch(
      /^Scan failed: scanimage exited with code 1: scanimage: sane_start: Device busy/,
    );
    expect(h.buttons(h.last("editMessageText"))).toContain("➕ Scan page");
  });

  it("cancels a session and cleans up its directory", async () => {
    const h = harness(sb);
    await h.text("/start");
    await h.press("main:scan");
    await h.press("scan:page");
    expect(sb.services.sessions.size).toBe(1);
    await h.press("scan:cancel");
    expect(h.last("editMessageText")?.payload.text).toBe("Session cancelled.");
    expect(sb.services.sessions.size).toBe(0);
  });

  it("/cancel leaves a conversation and shows the menu", async () => {
    const h = harness(sb);
    await h.text("/start");
    await h.press("main:scan");
    await h.text("/cancel");
    expect(h.last("sendMessage")?.payload.text).toMatch(/^Hi!/);
  });

  it("/status reports devices and printer", async () => {
    const h = harness(sb);
    await h.text("/status");
    const text = h.last("sendMessage")?.payload.text as string;
    expect(text).toContain("Scanner device: airscan:e0:Scanner");
    expect(text).toContain("• airscan:e0:Fake MFP (eSCL Fake MFP ip=192.0.2.10)");
    expect(text).toContain("Printer queue: FakeQueue");
    expect(text).toContain("Printer: printer FakeQueue is idle.");
    expect(text).toContain("Active scan sessions: 0");
  });

  it("prints a PDF document with the chosen number of copies", async () => {
    const downloaded: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      downloaded.push(String(url));
      return new Response(Buffer.from("%PDF-1.4 test"), { status: 200 });
    };
    const h = harness(sb, { fetchImpl });
    await h.text("/start");
    await h.press("main:print");
    expect(h.last("sendMessage")?.payload.text).toBe(
      "Print mode\nCopies: 1\nSend a PDF or an image as a document.",
    );
    await h.press("print:copies");
    await h.press("print:copies");
    expect(h.last("editMessageText")?.payload.text).toMatch(/Copies: 3/);

    await h.document({
      file_id: "f1",
      file_name: "doc.pdf",
      mime_type: "application/pdf",
      file_size: 1000,
    });
    expect(downloaded).toEqual([
      "http://telegram.test/file/bot123456:TEST-TOKEN/documents/f1.bin",
    ]);
    expect(h.last("editMessageText")?.payload.text).toBe(
      "Sent to printer (job FakeQueue-42, copies: 3).",
    );
    const lp = (await sb.calls()).find((c) => c.startsWith("lp "));
    expect(lp).toMatch(/^lp -d FakeQueue -n 3 -- .*\.pdf$/);
  });

  it("converts a photo to PDF before printing", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(Buffer.from("jpegdata"), { status: 200 });
    const h = harness(sb, { fetchImpl });
    await h.text("/start");
    await h.press("main:print");
    await h.photo();
    expect(h.last("getFile")?.payload.file_id).toBe("big");
    expect(h.last("editMessageText")?.payload.text).toMatch(/^Sent to printer/);
    const calls = await sb.calls();
    expect(calls.find((c) => c.startsWith("img2pdf"))).toMatch(
      /img2pdf .*\.img -o .*\.pdf$/,
    );
    expect(calls.find((c) => c.startsWith("lp "))).toMatch(/-- .*\.pdf$/);
  });

  it("rejects unsupported and oversized files but keeps the session open", async () => {
    const h = harness(sb);
    await h.text("/start");
    await h.press("main:print");
    await h.document({
      file_id: "f2",
      file_name: "notes.docx",
      mime_type: "application/octet-stream",
    });
    expect(h.last("sendMessage")?.payload.text).toBe(
      "Send a PDF or an image (as a document or a photo).",
    );
    await h.document({
      file_id: "f3",
      file_name: "huge.pdf",
      mime_type: "application/pdf",
      file_size: 21 * 1024 * 1024,
    });
    expect(h.last("sendMessage")?.payload.text).toMatch(/too large \(>20 MB\)/);
    expect((await sb.calls()).some((c) => c.startsWith("lp "))).toBe(false);
    await h.press("print:cancel");
    expect(h.last("editMessageText")?.payload.text).toBe("Session cancelled.");
  });

  it("reports print failures", async () => {
    process.env.FAKE_LP_FAIL = "1";
    const fetchImpl: typeof fetch = async () =>
      new Response(Buffer.from("%PDF"), { status: 200 });
    const h = harness(sb, { fetchImpl });
    await h.text("/start");
    await h.press("main:print");
    await h.document({
      file_id: "f1",
      file_name: "doc.pdf",
      mime_type: "application/pdf",
    });
    expect(h.last("editMessageText")?.payload.text).toMatch(
      /^Print failed: lp exited with code 1: lp: The printer or class does not exist\./,
    );
  });

  it("answers stale buttons by re-showing the menu", async () => {
    const h = harness(sb);
    await h.press("scan:page");
    expect(h.calls.map((c) => c.method)).toEqual(["answerCallbackQuery", "sendMessage"]);
  });
});
