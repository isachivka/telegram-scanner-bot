import { InlineKeyboard } from "grammy";
import { btn } from "../util/i18n.js";
import type { ScanMode, ScanDpi } from "../services/scanner.js";

export const CB = {
  startScan: "main:start",
  scanPage: "scan:page",
  finish: "scan:finish",
  cancel: "scan:cancel",
  toggleMode: "scan:mode",
  cycleDpi: "scan:dpi",
} as const;

export function mainMenuKb(): InlineKeyboard {
  return new InlineKeyboard().text(btn.startScan, CB.startScan);
}

export function sessionKb(mode: ScanMode, dpi: ScanDpi): InlineKeyboard {
  return new InlineKeyboard()
    .text(btn.scanPage, CB.scanPage)
    .row()
    .text(btn.toggleMode(mode), CB.toggleMode)
    .text(btn.cycleDpi(dpi), CB.cycleDpi)
    .row()
    .text(btn.finish, CB.finish)
    .text(btn.cancel, CB.cancel);
}

export function scanningKb(): InlineKeyboard {
  return new InlineKeyboard().text("⏳ Сканирую…", "noop");
}
