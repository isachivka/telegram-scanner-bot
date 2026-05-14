import { InputFile } from "grammy";
import type { Conversation } from "@grammyjs/conversations";
import type { MyContext, MyConversationContext } from "../bot.js";
import * as sessionStore from "../services/sessionStore.js";
import * as scanner from "../services/scanner.js";
import * as pdfService from "../services/pdf.js";
import { CB, sessionKb, mainMenuKb, scanningKb } from "../handlers/menu.js";
import { t } from "../util/i18n.js";
import { logger } from "../util/logger.js";

const DPI_CYCLE: scanner.ScanDpi[] = [200, 300, 600];

const CB_PATTERN = new RegExp(
  `^(${[CB.scanPage, CB.finish, CB.cancel, CB.toggleMode, CB.cycleDpi].join("|")})$`,
);

export async function scanSession(
  conversation: Conversation<MyContext, MyConversationContext>,
  ctx: MyConversationContext,
): Promise<void> {
  const userId = ctx.from?.id;
  if (userId === undefined) {
    return;
  }

  let mode: scanner.ScanMode = "Color";
  let dpi: scanner.ScanDpi = 300;
  let pages = 0;
  const session = await conversation.external(() => sessionStore.create(userId));

  const menuMsg = await ctx.reply(t.sessionStarted(mode, dpi, pages), {
    reply_markup: sessionKb(mode, dpi),
  });
  const chatId = menuMsg.chat.id;
  const menuMsgId = menuMsg.message_id;

  while (true) {
    const cb = await conversation.waitForCallbackQuery(CB_PATTERN);
    const data = cb.callbackQuery.data ?? "";

    if (data === CB.cancel) {
      await cb.answerCallbackQuery();
      await conversation.external(() => sessionStore.discard(session));
      await ctx.api.editMessageText(chatId, menuMsgId, t.cancelled, {
        reply_markup: mainMenuKb(),
      });
      return;
    }

    if (data === CB.toggleMode) {
      mode = mode === "Color" ? "Gray" : "Color";
      await cb.answerCallbackQuery();
      await ctx.api.editMessageText(
        chatId,
        menuMsgId,
        t.sessionStarted(mode, dpi, pages),
        { reply_markup: sessionKb(mode, dpi) },
      );
      continue;
    }

    if (data === CB.cycleDpi) {
      const idx = DPI_CYCLE.indexOf(dpi);
      dpi = DPI_CYCLE[(idx + 1) % DPI_CYCLE.length];
      await cb.answerCallbackQuery();
      await ctx.api.editMessageText(
        chatId,
        menuMsgId,
        t.sessionStarted(mode, dpi, pages),
        { reply_markup: sessionKb(mode, dpi) },
      );
      continue;
    }

    if (data === CB.scanPage) {
      await cb.answerCallbackQuery();
      await ctx.api.editMessageText(chatId, menuMsgId, t.scanning, {
        reply_markup: scanningKb(),
      });

      const nextPage = pages + 1;
      try {
        await conversation.external(() =>
          scanner.scanOne(session, nextPage, { mode, dpi }),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err }, "scan failed");
        await ctx.api.editMessageText(chatId, menuMsgId, t.scanFailed(msg), {
          reply_markup: sessionKb(mode, dpi),
        });
        continue;
      }
      pages = nextPage;

      await ctx.api.editMessageText(
        chatId,
        menuMsgId,
        `${t.pageScanned(pages)}\n\n${t.sessionStarted(mode, dpi, pages)}`,
        { reply_markup: sessionKb(mode, dpi) },
      );
      continue;
    }

    if (data === CB.finish) {
      if (pages === 0) {
        await cb.answerCallbackQuery({ text: t.nothingToFinish, show_alert: true });
        continue;
      }
      await cb.answerCallbackQuery();
      await ctx.api.editMessageText(chatId, menuMsgId, t.buildingPdf);

      let pdfPath: string;
      try {
        pdfPath = await conversation.external(() => pdfService.buildPdf(session));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err }, "pdf build failed");
        await ctx.api.editMessageText(chatId, menuMsgId, t.scanFailed(msg), {
          reply_markup: sessionKb(mode, dpi),
        });
        continue;
      }

      await ctx.replyWithDocument(new InputFile(pdfPath), {
        caption: t.done(pages),
      });
      await conversation.external(() => sessionStore.discard(session));
      await ctx.api.editMessageText(chatId, menuMsgId, t.mainMenu, {
        reply_markup: mainMenuKb(),
      });
      return;
    }
  }
}
