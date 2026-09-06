import type { Chat } from "grammy/types";
import type { Services } from "../core/services.js";
import type { Dictionary } from "./i18n/index.js";
import { errorMessage } from "../util/exec.js";

export async function statusReport(
  services: Services,
  t: Dictionary,
  chat?: Chat,
): Promise<string> {
  const { config, scanner, printer, sessions } = services;
  const lines: string[] = [t.status.header, ""];

  lines.push(
    config.scanner.device
      ? t.status.scannerDevice(config.scanner.device)
      : t.status.scannerAuto,
  );
  try {
    const devices = await scanner.listDevices();
    lines.push(t.status.devicesFound(devices.map((d) => `${d.name} (${d.description})`)));
  } catch (err) {
    lines.push(t.status.devicesError(errorMessage(err)));
  }

  lines.push("");
  if (printer) {
    lines.push(t.status.printerQueue(printer.queue));
    try {
      lines.push(t.status.printerState(await printer.status()));
    } catch (err) {
      lines.push(t.status.printerError(errorMessage(err)));
    }
  } else {
    lines.push(t.status.printerNone);
  }

  lines.push("", t.status.activeSessions(sessions.size));
  if (chat && chat.type !== "private") {
    const allowed = config.telegram?.allowedChatIds.has(chat.id) ?? false;
    lines.push("", t.status.chat(chat.id, allowed));
  }
  return lines.join("\n");
}
