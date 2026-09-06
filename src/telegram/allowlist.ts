import type { Middleware } from "grammy";
import type { BotContext, BotEnv } from "./context.js";

/**
 * Who may use the bot:
 *  - users in ALLOWED_USER_IDS, in private chats and in any group;
 *  - everyone inside a group listed in ALLOWED_CHAT_IDS.
 * Strangers in a private chat are told their user id so the owner can add
 * them. In groups the bot stays silent instead of announcing ids to bystanders;
 * an allowed user can read the chat id from /status.
 */
export function allowlist(env: BotEnv): Middleware<BotContext> {
  const { log } = env.services;
  const telegram = env.services.config.telegram;
  const users = telegram?.allowedUserIds ?? new Set<number>();
  const chats = telegram?.allowedChatIds ?? new Set<number>();
  return async (ctx, next) => {
    const user = ctx.from;
    const chat = ctx.chat;
    if (!user || !chat) return;
    const isPrivate = chat.type === "private";
    if (users.has(user.id) || (!isPrivate && chats.has(chat.id))) return next();
    log.warn(
      {
        userId: user.id,
        username: user.username,
        firstName: user.first_name,
        chatId: chat.id,
        chatType: chat.type,
        chatTitle: "title" in chat ? chat.title : undefined,
      },
      isPrivate
        ? "rejected non-allowlisted user"
        : "ignored update from non-allowlisted chat",
    );
    // Answer callback queries so the client stops showing a spinner.
    if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => undefined);
    if (isPrivate) await ctx.reply(env.t.unauthorized(user.id));
  };
}
