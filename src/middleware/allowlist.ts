import type { Middleware } from "grammy";
import { config } from "../config.js";
import { logger } from "../util/logger.js";
import { t } from "../util/i18n.js";
import type { MyContext } from "../bot.js";

export const allowlist: Middleware<MyContext> = async (ctx, next) => {
  const user = ctx.from;
  if (!user) {
    return;
  }
  const allowed = config.allowedUserIds.has(user.id);
  if (allowed) {
    return next();
  }
  logger.warn(
    {
      userId: user.id,
      username: user.username,
      firstName: user.first_name,
    },
    "rejected non-allowlisted user",
  );
  await ctx.reply(t.unauthorized(user.id));
};
