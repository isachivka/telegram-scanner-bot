export const en = {
  commands: {
    start: "Open the main menu",
    cancel: "Cancel the current session",
    status: "Show scanner and printer status",
  },
  welcome: "Hi! I turn your scanner into a scan-to-PDF service. Pick an action below.",
  mainMenu: "Main menu",
  unauthorized: (id: number) =>
    `Access denied.\nYour Telegram user ID: ${id}\nAdd it to ALLOWED_USER_IDS and restart the bot.`,
  busy: "The scanner is busy, please wait.",
  cancelled: "Session cancelled.",

  session: (mode: string, dpi: number, pages: number) =>
    `Scan session\nMode: ${mode}\nDPI: ${dpi}\nPages: ${pages}`,
  scanning: "Scanning page…",
  scanningAdf: "Scanning the feeder…",
  pageScanned: (n: number) => `Done, pages scanned: ${n}`,
  adfScanned: (added: number, total: number) =>
    `Done, ${added} page(s) from the feeder, total: ${total}`,
  adfEmpty: "The feeder is empty.",
  scanFailed: (err: string) => `Scan failed: ${err}`,
  nothingToFinish: "No pages yet. Scan at least one first.",
  buildingPdf: "Building PDF…",
  pdfFailed: (err: string) => `Could not build the PDF: ${err}`,
  done: (pages: number) => `Done, ${pages} page(s).`,

  printPrompt: (copies: number) =>
    `Print mode\nCopies: ${copies}\nSend a PDF or an image as a document.`,
  printNeedsFile: "Send a PDF or an image (as a document or a photo).",
  printTooLarge: (mb: number) =>
    `File is too large (>${mb} MB). Telegram bots cannot download it.`,
  printSent: (jobId: string, copies: number) =>
    `Sent to printer (job ${jobId}, copies: ${copies}).`,
  printFailed: (err: string) => `Print failed: ${err}`,
  printDisabled: "Printing is not configured on this bot.",

  status: {
    header: "Status",
    scannerDevice: (d: string) => `Scanner device: ${d}`,
    scannerAuto: "Scanner device: first device SANE finds",
    devicesFound: (list: string[]) =>
      list.length
        ? `SANE devices:\n${list.map((d) => `• ${d}`).join("\n")}`
        : "SANE devices: none found",
    devicesError: (err: string) => `SANE devices: error (${err})`,
    printerQueue: (q: string) => `Printer queue: ${q}`,
    printerState: (s: string) => `Printer: ${s}`,
    printerError: (err: string) => `Printer: error (${err})`,
    printerNone: "Printer: not configured",
    activeSessions: (n: number) => `Active scan sessions: ${n}`,
  },

  btn: {
    startScan: "📄 Scan",
    startPrint: "🖨 Print",
    scanPage: "➕ Scan page",
    scanAdf: "📚 Scan feeder",
    finish: "✅ Finish",
    cancel: "❌ Cancel",
    mode: (mode: string) => `🎨 ${mode}`,
    dpi: (dpi: number) => `🔍 ${dpi} dpi`,
    copies: (n: number) => `🧮 Copies: ${n}`,
    working: "⏳ Working…",
  },
};

export type Dictionary = typeof en;
