import { InlineKeyboard } from "grammy";
import type { Dictionary } from "./i18n/index.js";

export const CB = {
  startScan: "main:scan",
  startPrint: "main:print",
  scanPage: "scan:page",
  scanAdf: "scan:adf",
  finish: "scan:finish",
  cancel: "scan:cancel",
  cycleMode: "scan:mode",
  cycleDpi: "scan:dpi",
  cycleCopies: "print:copies",
  printCancel: "print:cancel",
  noop: "noop",
} as const;

export interface KeyboardOptions {
  printEnabled: boolean;
  adfEnabled: boolean;
}

export function mainMenuKb(t: Dictionary, o: KeyboardOptions): InlineKeyboard {
  const kb = new InlineKeyboard().text(t.btn.startScan, CB.startScan);
  if (o.printEnabled) kb.text(t.btn.startPrint, CB.startPrint);
  return kb;
}

export function scanSessionKb(
  t: Dictionary,
  o: KeyboardOptions,
  mode: string,
  dpi: number,
): InlineKeyboard {
  const kb = new InlineKeyboard().text(t.btn.scanPage, CB.scanPage);
  if (o.adfEnabled) kb.text(t.btn.scanAdf, CB.scanAdf);
  return kb
    .row()
    .text(t.btn.mode(mode), CB.cycleMode)
    .text(t.btn.dpi(dpi), CB.cycleDpi)
    .row()
    .text(t.btn.finish, CB.finish)
    .text(t.btn.cancel, CB.cancel);
}

export function workingKb(t: Dictionary): InlineKeyboard {
  return new InlineKeyboard().text(t.btn.working, CB.noop);
}

export function printSessionKb(t: Dictionary, copies: number): InlineKeyboard {
  return new InlineKeyboard()
    .text(t.btn.copies(copies), CB.cycleCopies)
    .row()
    .text(t.btn.cancel, CB.printCancel);
}
