import type { Middleware } from "grammy";
import type { BotContext, BotEnv } from "./context.js";

export function allowlist(env: BotEnv): Middleware<BotContext> {
  const { log } = env.services;
  const allowed = env.services.config.telegram?.allowedUserIds ?? new Set<number>();
  return async (ctx, next) => {
    const user = ctx.from;
    if (!user) return;
    if (allowed.has(user.id)) return next();
    log.warn(
      { userId: user.id, username: user.username, firstName: user.first_name },
      "rejected non-allowlisted user",
    );
    // Answer callback queries so the client stops showing a spinner.
    if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => undefined);
    await ctx.reply(env.t.unauthorized(user.id));
  };
}
