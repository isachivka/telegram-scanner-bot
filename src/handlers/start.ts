import type { MyContext } from "../bot.js";
import { t } from "../util/i18n.js";
import { mainMenuKb } from "./menu.js";

export async function handleStart(ctx: MyContext): Promise<void> {
  await ctx.reply(t.welcome, { reply_markup: mainMenuKb() });
}
