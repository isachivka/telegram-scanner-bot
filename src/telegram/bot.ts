import {
  Bot,
  GrammyError,
  HttpError,
  MemorySessionStorage,
  type BotConfig,
} from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
import type { Services } from "../core/services.js";
import { getDictionary } from "./i18n/index.js";
import type { BotContext, BotEnv, ConvContext } from "./context.js";
import { allowlist } from "./allowlist.js";
import { CB, mainMenuKb } from "./keyboards.js";
import { scanSession } from "./scanSession.js";
import { printSession } from "./printSession.js";
import { statusReport } from "./status.js";

export const SCAN_CONVERSATION = "scan";
export const PRINT_CONVERSATION = "print";

export interface CreateBotOptions {
  botConfig?: BotConfig<BotContext>;
  download?: BotEnv["download"];
}

export function createBot(
  services: Services,
  opts: CreateBotOptions = {},
): Bot<BotContext> {
  const { config, log } = services;
  const telegram = config.telegram;
  if (!telegram) throw new Error("TELEGRAM_BOT_TOKEN is not configured");

  const env: BotEnv = {
    services,
    t: getDictionary(telegram.language),
    kb: {
      printEnabled: services.printer !== undefined,
      adfEnabled: config.scanner.adfSource !== undefined,
    },
    download: opts.download,
  };
  const { t, kb } = env;

  const bot = new Bot<BotContext>(telegram.botToken, opts.botConfig);

  bot.use(async (ctx, next) => {
    const chat = ctx.chat;
    const fields = {
      from: ctx.from?.id,
      chatId: chat?.id,
      chatType: chat?.type,
      chatTitle: chat && "title" in chat ? chat.title : undefined,
      text: ctx.message?.text,
      data: ctx.callbackQuery?.data,
    };
    // Group traffic is logged at info level so the chat id is easy to find
    // when filling in ALLOWED_CHAT_IDS.
    if (chat && chat.type !== "private") log.info(fields, "group update");
    else log.debug(fields, "update");
    await next();
  });
  // Before the allow-list: whoever adds the bot to a chat, the id gets logged.
  bot.on("my_chat_member", async (ctx) => {
    const { chat, new_chat_member } = ctx.myChatMember;
    log.info(
      {
        chatId: chat.id,
        chatType: chat.type,
        chatTitle: "title" in chat ? chat.title : undefined,
        status: new_chat_member.status,
        by: ctx.from.id,
      },
      `bot membership changed: ${new_chat_member.status}`,
    );
  });
  bot.use(allowlist(env));
  // One conversation per person per chat, so two family members in the same
  // group can each run their own scan session.
  bot.use(
    conversations<BotContext, ConvContext>({
      storage: {
        type: "key",
        getStorageKey: (ctx) =>
          ctx.chatId !== undefined && ctx.from
            ? `${ctx.chatId}:${ctx.from.id}`
            : undefined,
        adapter: new MemorySessionStorage(),
      },
    }),
  );

  const showMainMenu = (ctx: BotContext) =>
    ctx.reply(t.welcome, { reply_markup: mainMenuKb(t, kb) });

  // Commands that must work while a conversation is active go before createConversation().
  bot.command("cancel", async (ctx) => {
    await ctx.conversation.exitAll();
    await showMainMenu(ctx);
  });
  bot.command("status", async (ctx) => {
    await ctx.reply(await statusReport(services, t, ctx.chat));
  });

  bot.use(createConversation(scanSession(env), SCAN_CONVERSATION));
  if (services.printer) {
    bot.use(createConversation(printSession(env), PRINT_CONVERSATION));
  }

  bot.command("start", showMainMenu);

  bot.callbackQuery(CB.startScan, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter(SCAN_CONVERSATION);
  });
  bot.callbackQuery(CB.startPrint, async (ctx) => {
    if (!services.printer) {
      await ctx.answerCallbackQuery({ text: t.printDisabled, show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter(PRINT_CONVERSATION);
  });
  bot.callbackQuery(CB.noop, (ctx) => ctx.answerCallbackQuery());
  // Stale buttons from a finished conversation: acknowledge and re-show the menu.
  bot.on("callback_query:data", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMainMenu(ctx);
  });

  bot.catch((err) => {
    const e = err.error;
    if (e instanceof GrammyError) log.error({ err: e.description }, "telegram api error");
    else if (e instanceof HttpError)
      log.error({ err: e.message }, "telegram transport error");
    else log.error({ err: e }, "unhandled bot error");
  });

  return bot;
}

export async function startBot(services: Services): Promise<Bot<BotContext>> {
  const { config, log } = services;
  const t = getDictionary(config.telegram!.language);
  const bot = createBot(services);
  await bot.api.setMyCommands([
    { command: "start", description: t.commands.start },
    { command: "cancel", description: t.commands.cancel },
    { command: "status", description: t.commands.status },
  ]);
  void bot.start({
    onStart: (me) => log.info({ username: me.username }, "telegram bot connected"),
  });
  return bot;
}
