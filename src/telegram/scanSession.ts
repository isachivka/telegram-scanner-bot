import { InputFile } from "grammy";
import path from "node:path";
import type { Conv, ConvContext, BotEnv } from "./context.js";
import { CB, mainMenuKb, scanSessionKb, workingKb } from "./keyboards.js";
import { imagesToPdf } from "../core/pdf.js";
import { scanFileName } from "../core/services.js";
import { errorMessage } from "../util/exec.js";

const SESSION_CB = new RegExp(
  `^(${[CB.scanPage, CB.scanAdf, CB.finish, CB.cancel, CB.cycleMode, CB.cycleDpi].join("|")})$`,
);

function cycle<T>(options: readonly T[], current: T): T {
  const idx = options.indexOf(current);
  return options[(idx + 1) % options.length]!;
}

export function scanSession(env: BotEnv) {
  const { services, t, kb } = env;
  const { scanner, sessions, log, config } = services;

  return async function scanSessionConversation(
    conv: Conv,
    ctx: ConvContext,
  ): Promise<void> {
    const userId = ctx.from?.id;
    if (userId === undefined) return;

    let mode = config.scanner.defaultMode;
    let dpi = config.scanner.defaultDpi;
    let pages = 0;
    const session = await conv.external(() => sessions.create(String(userId)));

    const menu = await ctx.reply(t.session(mode, dpi, pages), {
      reply_markup: scanSessionKb(t, kb, mode, dpi),
    });
    const chatId = menu.chat.id;
    const menuId = menu.message_id;

    const showMenu = (prefix?: string) =>
      ctx.api.editMessageText(
        chatId,
        menuId,
        prefix
          ? `${prefix}\n\n${t.session(mode, dpi, pages)}`
          : t.session(mode, dpi, pages),
        { reply_markup: scanSessionKb(t, kb, mode, dpi) },
      );

    while (true) {
      const cb = await conv.waitForCallbackQuery(SESSION_CB);
      const data = cb.callbackQuery.data;

      if (data === CB.cancel) {
        await cb.answerCallbackQuery();
        await conv.external(() => sessions.discard(session));
        await ctx.api.editMessageText(chatId, menuId, t.cancelled, {
          reply_markup: mainMenuKb(t, kb),
        });
        return;
      }

      if (data === CB.cycleMode) {
        mode = cycle(config.scanner.modes, mode);
        await cb.answerCallbackQuery();
        await showMenu();
        continue;
      }

      if (data === CB.cycleDpi) {
        dpi = cycle(config.scanner.dpiOptions, dpi);
        await cb.answerCallbackQuery();
        await showMenu();
        continue;
      }

      if (data === CB.scanPage || data === CB.scanAdf) {
        if (scanner.isBusy()) {
          await cb.answerCallbackQuery({ text: t.busy, show_alert: true });
          continue;
        }
        const adf = data === CB.scanAdf;
        await cb.answerCallbackQuery();
        await ctx.api.editMessageText(chatId, menuId, adf ? t.scanningAdf : t.scanning, {
          reply_markup: workingKb(t),
        });
        try {
          if (adf) {
            const { pages: produced } = await conv.external(() =>
              scanner.scanFeeder(session.dir, pages + 1, { mode, dpi }),
            );
            pages += produced.length;
            await showMenu(
              produced.length ? t.adfScanned(produced.length, pages) : t.adfEmpty,
            );
          } else {
            const out = sessions.pagePath(session, pages + 1, scanner.extension);
            await conv.external(() => scanner.scanPage(out, { mode, dpi }));
            pages += 1;
            await showMenu(t.pageScanned(pages));
          }
        } catch (err) {
          log.error({ err }, "scan failed");
          await showMenu(t.scanFailed(errorMessage(err)));
        }
        continue;
      }

      if (data === CB.finish) {
        if (pages === 0) {
          await cb.answerCallbackQuery({ text: t.nothingToFinish, show_alert: true });
          continue;
        }
        await cb.answerCallbackQuery();
        await ctx.api.editMessageText(chatId, menuId, t.buildingPdf, {
          reply_markup: workingKb(t),
        });
        let pdfPath: string;
        try {
          pdfPath = await conv.external(async () => {
            const images = Array.from({ length: pages }, (_, i) =>
              sessions.pagePath(session, i + 1, scanner.extension),
            );
            return imagesToPdf(images, path.join(session.dir, "scan.pdf"));
          });
        } catch (err) {
          log.error({ err }, "pdf build failed");
          await showMenu(t.pdfFailed(errorMessage(err)));
          continue;
        }
        await ctx.replyWithDocument(new InputFile(pdfPath, scanFileName()), {
          caption: t.done(pages),
        });
        await conv.external(() => sessions.discard(session));
        await ctx.api.editMessageText(chatId, menuId, t.mainMenu, {
          reply_markup: mainMenuKb(t, kb),
        });
        return;
      }
    }
  };
}
