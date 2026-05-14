import { GrammyError, HttpError } from "grammy";
import { createBot } from "./bot.js";
import { logger } from "./util/logger.js";
import { config } from "./config.js";
import * as sessionStore from "./services/sessionStore.js";

async function main(): Promise<void> {
  await sessionStore.sweepAll();

  const bot = createBot();

  bot.catch((err) => {
    const e = err.error;
    if (e instanceof GrammyError) {
      logger.error({ err: e.description }, "telegram api error");
    } else if (e instanceof HttpError) {
      logger.error({ err: e.message }, "telegram transport error");
    } else {
      logger.error({ err: e }, "unhandled bot error");
    }
  });

  await bot.api.setMyCommands([
    { command: "start", description: "Открыть главное меню" },
    { command: "cancel", description: "Отменить текущую сессию" },
  ]);

  logger.info(
    {
      allowedUserIds: [...config.allowedUserIds],
      scannerDevice: config.scannerDevice,
    },
    "scanner-bot starting",
  );

  await bot.start({
    onStart: (me) => logger.info({ username: me.username }, "bot connected"),
  });
}

main().catch((err) => {
  logger.fatal({ err }, "fatal error during startup");
  process.exit(1);
});
