import { ConfigError, loadConfig } from "./config.js";
import { createServices } from "./core/services.js";
import { createLogger } from "./util/logger.js";
import { runCheck } from "./check.js";
import { startBot } from "./telegram/bot.js";
import { startMcpHttp } from "./mcp/http.js";
import { startMcpStdio } from "./mcp/stdio.js";

const USAGE = `usage: scanner-bot [command]

  (no command)   run the Telegram bot and/or the MCP HTTP endpoint, whichever is configured
  mcp-stdio      serve MCP over stdin/stdout only (for clients that spawn the server)
  --check        validate configuration, scanner, printer and Telegram token, then exit
`;

async function main(argv: string[]): Promise<void> {
  const command = argv[0];
  if (command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return;
  }

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }

  if (command === "mcp-stdio") {
    // stdout is the MCP channel; keep logs on stderr.
    const log = createLogger(config.logLevel);
    const services = createServices(config, log);
    await services.sessions.sweep();
    await startMcpStdio(services);
    return;
  }

  const log = createLogger(config.logLevel);
  const services = createServices(config, log);

  if (command === "--check") {
    const { ok, lines } = await runCheck(services);
    process.stdout.write(`${lines.join("\n")}\n`);
    process.exit(ok ? 0 : 1);
  }
  if (command !== undefined) {
    process.stderr.write(`unknown command: ${command}\n\n${USAGE}`);
    process.exit(2);
  }

  if (!config.telegram && !config.mcp.http) {
    process.stderr.write(
      "Nothing to run: set TELEGRAM_BOT_TOKEN and/or MCP_HTTP_PORT (+ MCP_AUTH_TOKEN).\n",
    );
    process.exit(2);
  }

  await services.sessions.sweep();
  const stops: Array<() => Promise<void>> = [];

  if (config.mcp.http) {
    const server = await startMcpHttp(services);
    stops.push(() => new Promise((r) => server.close(() => r())));
  }
  if (config.telegram) {
    const bot = await startBot(services);
    stops.push(() => bot.stop());
  }

  const shutdown = (signal: string) => {
    log.info({ signal }, "shutting down");
    Promise.all(stops.map((s) => s())).finally(() => process.exit(0));
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(
    `fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
