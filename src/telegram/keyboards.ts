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
  startPhoto: "main:photo",
  photoScan: "photo:scan",
  photoDone: "photo:done",
  photoRotate: "photo:rotate",
  photoRescan: "photo:rescan",
  photoNext: "photo:next",
  photoDrop: "photo:drop",
  placeOk: "photo:place-ok",
  placeRetry: "photo:place-retry",
  placeNoGeo: "photo:place-nogeo",
  uploadRetry: "photo:upload-retry",
  noop: "noop",
} as const;

export interface KeyboardOptions {
  printEnabled: boolean;
  adfEnabled: boolean;
  photoEnabled?: boolean;
}

export function mainMenuKb(t: Dictionary, o: KeyboardOptions): InlineKeyboard {
  const kb = new InlineKeyboard().text(t.btn.startScan, CB.startScan);
  if (o.printEnabled) kb.text(t.btn.startPrint, CB.startPrint);
  if (o.photoEnabled) kb.row().text(t.btn.startPhoto, CB.startPhoto);
  return kb;
}

export function photoIdleKb(t: Dictionary): InlineKeyboard {
  return new InlineKeyboard()
    .text(t.btn.photoScan, CB.photoScan)
    .text(t.btn.photoDone, CB.photoDone);
}

export function photoPreviewKb(t: Dictionary): InlineKeyboard {
  return new InlineKeyboard()
    .text(t.btn.photoRotate, CB.photoRotate)
    .text(t.btn.photoRescan, CB.photoRescan)
    .row()
    .text(t.btn.photoNext, CB.photoNext)
    .text(t.btn.photoDrop, CB.photoDrop);
}

export function placeKb(t: Dictionary, found: boolean): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (found) kb.text(t.btn.placeOk, CB.placeOk);
  return kb
    .text(t.btn.placeRetry, CB.placeRetry)
    .row()
    .text(t.btn.placeNoGeo, CB.placeNoGeo);
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

export function uploadFailedKb(t: Dictionary): InlineKeyboard {
  return new InlineKeyboard()
    .text(t.btn.uploadRetry, CB.uploadRetry)
    .text(t.btn.photoDrop, CB.photoDrop);
}
