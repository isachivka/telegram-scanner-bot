import { rm } from "node:fs/promises";
import path from "node:path";
import type { Conv, ConvContext, BotEnv } from "./context.js";
import { CB, mainMenuKb, printSessionKb, workingKb } from "./keyboards.js";
import { downloadTelegramFile } from "./download.js";
import { imagesToPdf, isImage, isPdf } from "../core/pdf.js";
import { errorMessage } from "../util/exec.js";

function cycle<T>(options: readonly T[], current: T): T {
  const idx = options.indexOf(current);
  return options[(idx + 1) % options.length]!;
}

export function printSession(env: BotEnv) {
  const { services, t, kb } = env;
  const { log, config } = services;
  const printer = services.printer!;
  const botToken = config.telegram!.botToken;
  const tmpRoot = path.join(config.scanner.tmpDir, "prints");

  return async function printSessionConversation(
    conv: Conv,
    ctx: ConvContext,
  ): Promise<void> {
    let copies = printer.copiesOptions[0]!;

    const menu = await ctx.reply(t.printPrompt(copies), {
      reply_markup: printSessionKb(t, copies),
    });
    const chatId = menu.chat.id;
    const menuId = menu.message_id;

    while (true) {
      const next = await conv.waitFor([
        "message:document",
        "message:photo",
        "callback_query:data",
      ]);

      if (next.callbackQuery) {
        const data = next.callbackQuery.data;
        if (data === CB.printCancel) {
          await next.answerCallbackQuery();
          await ctx.api.editMessageText(chatId, menuId, t.cancelled, {
            reply_markup: mainMenuKb(t, kb),
          });
          return;
        }
        if (data === CB.cycleCopies) {
          copies = cycle(printer.copiesOptions, copies);
          await next.answerCallbackQuery();
          await ctx.api.editMessageText(chatId, menuId, t.printPrompt(copies), {
            reply_markup: printSessionKb(t, copies),
          });
          continue;
        }
        await next.answerCallbackQuery();
        continue;
      }

      // Resolve what was sent: a PDF document, an image document, or a photo.
      const doc = next.message?.document;
      const photo = next.message?.photo?.at(-1);
      let fileId: string;
      let fileSize: number | undefined;
      let kind: "pdf" | "image";
      if (doc && isPdf(doc.mime_type, doc.file_name)) {
        fileId = doc.file_id;
        fileSize = doc.file_size;
        kind = "pdf";
      } else if (doc && isImage(doc.mime_type, doc.file_name)) {
        fileId = doc.file_id;
        fileSize = doc.file_size;
        kind = "image";
      } else if (photo) {
        fileId = photo.file_id;
        fileSize = photo.file_size;
        kind = "image";
      } else {
        await ctx.reply(t.printNeedsFile);
        continue;
      }
      if (fileSize && fileSize > printer.maxFileBytes) {
        await ctx.reply(t.printTooLarge(Math.round(printer.maxFileBytes / 1024 / 1024)));
        continue;
      }

      await ctx.api.editMessageReplyMarkup(chatId, menuId, {
        reply_markup: workingKb(t),
      });

      const userDir = path.join(tmpRoot, String(ctx.from?.id ?? "anon"));
      let localPath: string | undefined;
      try {
        localPath = await conv.external(async () => {
          const ext = kind === "pdf" ? "pdf" : "img";
          const downloaded = await downloadTelegramFile(
            ctx.api,
            botToken,
            fileId,
            userDir,
            ext,
            env.download,
          );
          if (kind === "pdf") return downloaded;
          return imagesToPdf([downloaded], downloaded.replace(/\.img$/, ".pdf"));
        });
        const job = await conv.external(() => printer.print(localPath!, { copies }));
        await ctx.api.editMessageText(chatId, menuId, t.printSent(job.jobId, copies), {
          reply_markup: mainMenuKb(t, kb),
        });
      } catch (err) {
        log.error({ err }, "print failed");
        await ctx.api.editMessageText(chatId, menuId, t.printFailed(errorMessage(err)), {
          reply_markup: mainMenuKb(t, kb),
        });
      } finally {
        await conv.external(() => rm(userDir, { recursive: true, force: true }));
      }
      return;
    }
  };
}
