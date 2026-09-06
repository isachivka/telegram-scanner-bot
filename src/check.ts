import { Bot } from "grammy";
import type { Services } from "./core/services.js";
import { describeConfig } from "./config.js";
import { errorMessage } from "./util/exec.js";

export interface CheckResult {
  ok: boolean;
  lines: string[];
}

/**
 * `--check`: validate the environment without starting anything. Prints what
 * SANE and CUPS see, and whether the Telegram token works.
 */
export async function runCheck(services: Services): Promise<CheckResult> {
  const { config, scanner, printer } = services;
  const lines: string[] = [];
  let ok = true;
  const pass = (msg: string) => lines.push(`✔ ${msg}`);
  const fail = (msg: string) => {
    ok = false;
    lines.push(`✘ ${msg}`);
  };
  const info = (msg: string) => lines.push(`  ${msg}`);

  pass("configuration parsed");
  info(JSON.stringify(describeConfig(config)));

  try {
    const devices = await scanner.listDevices();
    if (devices.length === 0) {
      fail(
        "scanimage -L found no devices (check SCANNER_URL / network_mode: host / airscan.conf)",
      );
    } else {
      pass(`scanimage -L found ${devices.length} device(s)`);
      for (const d of devices) info(`${d.name} — ${d.description}`);
      if (
        config.scanner.device &&
        !devices.some((d) => d.name === config.scanner.device)
      ) {
        fail(`SCANNER_DEVICE "${config.scanner.device}" is not in the list above`);
      }
    }
  } catch (err) {
    fail(`scanimage -L failed: ${errorMessage(err)}`);
  }

  if (printer) {
    try {
      pass(`lpstat -p ${printer.queue}: ${await printer.status()}`);
    } catch (err) {
      fail(
        `lpstat -p ${printer.queue} failed: ${errorMessage(err)} (check PRINTER_QUEUE / CUPS_SERVER)`,
      );
    }
  } else {
    info("printer: not configured (PRINTER_QUEUE unset), print features disabled");
  }

  if (config.telegram) {
    try {
      const me = await new Bot(config.telegram.botToken).api.getMe();
      pass(`telegram: token is valid, bot is @${me.username}`);
      if (config.telegram.allowedUserIds.size === 0) {
        info("ALLOWED_USER_IDS is empty: every user is rejected and shown their id");
      }
    } catch (err) {
      fail(`telegram getMe failed: ${errorMessage(err)}`);
    }
  } else {
    info("telegram: not configured (TELEGRAM_BOT_TOKEN unset)");
  }

  if (config.mcp.http) {
    pass(
      `mcp http: will listen on ${config.mcp.http.host}:${config.mcp.http.port}${config.mcp.http.path}`,
    );
  } else {
    info(
      "mcp http: disabled (MCP_HTTP_PORT unset); stdio mode available via `mcp-stdio`",
    );
  }

  return { ok, lines };
}
