import type { Middleware } from "grammy";
import { logger } from "../util/logger.js";
import type { MyContext } from "../bot.js";

export const requestLogger: Middleware<MyContext> = async (ctx, next) => {
  logger.info(
    {
      from: ctx.from?.id,
      username: ctx.from?.username,
      text: ctx.message?.text,
      data: ctx.callbackQuery?.data,
    },
    "update",
  );
  await next();
};
