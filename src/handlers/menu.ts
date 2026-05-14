import { InlineKeyboard } from "grammy";
import { btn } from "../util/i18n.js";
import type { ScanMode, ScanDpi } from "../services/scanner.js";

export const CB = {
  startScan: "main:scan",
  startPrint: "main:print",
  scanPage: "scan:page",
  finish: "scan:finish",
  cancel: "scan:cancel",
  toggleMode: "scan:mode",
  cycleDpi: "scan:dpi",
  cycleCopies: "print:copies",
  printCancel: "print:cancel",
} as const;

export function mainMenuKb(): InlineKeyboard {
  return new InlineKeyboard()
    .text(btn.startScan, CB.startScan)
    .text(btn.startPrint, CB.startPrint);
}

export function printSessionKb(copies: number): InlineKeyboard {
  return new InlineKeyboard()
    .text(btn.cycleCopies(copies), CB.cycleCopies)
    .row()
    .text(btn.cancel, CB.printCancel);
}

export function printingKb(): InlineKeyboard {
  return new InlineKeyboard().text("⏳ Отправляю…", "noop");
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
