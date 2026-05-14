import { Bot, type Context } from "grammy";
import {
  conversations,
  createConversation,
  type ConversationFlavor,
} from "@grammyjs/conversations";
import { config } from "./config.js";
import { allowlist } from "./middleware/allowlist.js";
import { requestLogger } from "./middleware/logger.js";
import { handleStart } from "./handlers/start.js";
import { CB } from "./handlers/menu.js";
import { scanSession } from "./conversations/scanSession.js";
import { printSession } from "./conversations/printSession.js";

export type MyContext = ConversationFlavor<Context>;
export type MyConversationContext = Context;

export const SCAN_SESSION = "scanSession";
export const PRINT_SESSION = "printSession";

export function createBot(): Bot<MyContext> {
  const bot = new Bot<MyContext>(config.botToken);

  bot.use(requestLogger);
  bot.use(allowlist);
  bot.use(conversations<MyContext, MyConversationContext>());
  bot.use(createConversation(scanSession, SCAN_SESSION));
  bot.use(createConversation(printSession, PRINT_SESSION));

  bot.command("start", handleStart);
  bot.command("cancel", async (ctx) => {
    await ctx.conversation.exit(SCAN_SESSION);
    await ctx.conversation.exit(PRINT_SESSION);
    await handleStart(ctx);
  });

  bot.callbackQuery(CB.startScan, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter(SCAN_SESSION);
  });

  bot.callbackQuery(CB.startPrint, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter(PRINT_SESSION);
  });

  bot.callbackQuery("noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  return bot;
}
