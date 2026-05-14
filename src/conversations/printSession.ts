import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Conversation } from "@grammyjs/conversations";
import { config } from "../config.js";
import type { MyContext, MyConversationContext } from "../bot.js";
import * as printer from "../services/printer.js";
import {
  CB,
  mainMenuKb,
  printSessionKb,
  printingKb,
} from "../handlers/menu.js";
import { t } from "../util/i18n.js";
import { logger } from "../util/logger.js";

const COPIES_CYCLE = [1, 2, 3, 5, 10];
const MAX_DOWNLOAD_MB = 20;
const PRINT_TMP_ROOT = "/tmp/prints";

export async function printSession(
  conversation: Conversation<MyContext, MyConversationContext>,
  ctx: MyConversationContext,
): Promise<void> {
  let copies = 1;

  const menuMsg = await ctx.reply(t.printPrompt(copies), {
    reply_markup: printSessionKb(copies),
  });
  const chatId = menuMsg.chat.id;
  const menuMsgId = menuMsg.message_id;

  while (true) {
    const next = await conversation.waitFor([
      "message:document",
      "callback_query:data",
    ]);

    if (next.callbackQuery) {
      const data = next.callbackQuery.data ?? "";
      if (data === CB.printCancel) {
        await next.answerCallbackQuery();
        await ctx.api.editMessageText(chatId, menuMsgId, t.cancelled, {
          reply_markup: mainMenuKb(),
        });
        return;
      }
      if (data === CB.cycleCopies) {
        const idx = COPIES_CYCLE.indexOf(copies);
        copies = COPIES_CYCLE[(idx + 1) % COPIES_CYCLE.length];
        await next.answerCallbackQuery();
        await ctx.api.editMessageText(chatId, menuMsgId, t.printPrompt(copies), {
          reply_markup: printSessionKb(copies),
        });
        continue;
      }
      await next.answerCallbackQuery();
      continue;
    }

    const doc = next.message?.document;
    if (!doc) {
      continue;
    }

    const isPdfMime = doc.mime_type === "application/pdf";
    const isPdfExt = (doc.file_name ?? "").toLowerCase().endsWith(".pdf");
    if (!isPdfMime && !isPdfExt) {
      await ctx.reply(t.printNeedsPdf);
      continue;
    }
    if (doc.file_size && doc.file_size > MAX_DOWNLOAD_MB * 1024 * 1024) {
      await ctx.reply(t.printTooLarge(MAX_DOWNLOAD_MB));
      continue;
    }

    await ctx.api.editMessageReplyMarkup(chatId, menuMsgId, {
      reply_markup: printingKb(),
    });

    const localPath = await conversation.external(async () => {
      const dir = path.join(PRINT_TMP_ROOT, String(ctx.from?.id ?? "anon"));
      await mkdir(dir, { recursive: true });
      const target = path.join(dir, `${randomUUID()}.pdf`);
      const file = await ctx.api.getFile(doc.file_id);
      if (!file.file_path) {
        throw new Error("Telegram did not return file_path");
      }
      const url = `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`download failed: HTTP ${res.status}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(target, buf);
      return target;
    });

    try {
      const result = await conversation.external(() =>
        printer.printPdf(localPath, { copies }),
      );
      await ctx.api.editMessageText(
        chatId,
        menuMsgId,
        t.printSent(result.jobId, copies),
        { reply_markup: mainMenuKb() },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err }, "print failed");
      await ctx.api.editMessageText(chatId, menuMsgId, t.printFailed(msg), {
        reply_markup: mainMenuKb(),
      });
    } finally {
      await conversation.external(() => rm(localPath, { force: true }));
    }
    return;
  }
}
