import type { Context } from "grammy";
import type { Conversation, ConversationFlavor } from "@grammyjs/conversations";
import type { Services } from "../core/services.js";
import type { Dictionary } from "./i18n/index.js";
import type { KeyboardOptions } from "./keyboards.js";

/** Everything the handlers need, bundled so conversations can stay plain functions. */
export interface BotEnv {
  services: Services;
  t: Dictionary;
  kb: KeyboardOptions;
  /** Telegram file download overrides (tests point these at a stub). */
  download?: { apiRoot?: string; fetchImpl?: typeof fetch };
}

export type BotContext = ConversationFlavor<Context>;
export type ConvContext = Context;
export type Conv = Conversation<BotContext, ConvContext>;
