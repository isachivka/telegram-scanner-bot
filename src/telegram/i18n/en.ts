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

  photoDisabled: "Photo scanning to Immich is not configured on this bot.",
  photoNoKey: "There is no Immich API key for your Telegram account (IMMICH_API_KEYS).",
  photoIntro: (dpi: number, album?: string) =>
    `Paper photos → Immich (${dpi} dpi)\n\n` +
    `Put ONE photo face down on the glass, close the lid and press "Scan". ` +
    `I will crop the white background, ask roughly when and where it was taken, ` +
    `and upload it to Immich${album ? ` (album "${album}")` : ""}.`,
  photoScanning: (dpi: number) => `Scanning the photo at ${dpi} dpi, about 30 seconds…`,
  photoScanned: "Scanned.",
  photoPreview: 'Here it is. If it lies sideways, press "Rotate".',
  photoNotFound:
    'I could not find a photo on the glass, so this is the whole scan. Move the photo and press "Rescan" if needed.',
  photoReduced:
    "⚠️ The scanner could not do the high resolution this time, so this is 300 dpi. Rescan to try again.",
  photoScanFailed:
    'The scanner could not scan this time 😕 Check that it is on and the lid is closed, then press "Scan" again.',
  photoDropped: "Photo discarded.",
  askDate: (hasPrevious: boolean, previous?: string) =>
    "When was it taken, roughly?\n" +
    "For example: 1987, May 1987, summer 87, 12.05.1987, 1980s, late 70s.\n" +
    'Don\'t know — send "-".' +
    (hasPrevious
      ? `\nSame as the previous photo (${previous ?? "unknown"}) — send "=".`
      : ""),
  dateNotUnderstood:
    'I did not get that date. Try: 1987, May 1987, summer 87, 12.05.1987, 1980s — or "-" if unknown.',
  askPlace: (hasPrevious: boolean, previous?: string) =>
    'Where was it taken? A city, a place or an address: "Sochi", "Moscow, VDNH".\n' +
    'Don\'t know — send "-".' +
    (hasPrevious
      ? `\nSame as the previous photo (${previous ?? "unknown"}) — send "=".`
      : ""),
  placeFound: (name: string) => `📍 Found: ${name}\nIs that right?`,
  placeNotFound: (query: string) =>
    `Could not find "${query}" on the map. Write it differently (a city works best), or keep it without coordinates: then the place only goes into the description.`,
  datePlaceholder: "e.g. summer 1987",
  placePlaceholder: "e.g. Sochi",
  uploading: "Uploading to Immich…",
  uploaded: (link: string, count: number) =>
    `✅ In Immich: ${link}\nPhotos this session: ${count}.\n\nPut the next one on the glass and press "Scan", or "Finish".`,
  albumFailed: "(Uploaded, but could not add it to the album.)",
  uploadFailed:
    'Could not upload to Immich 😕 The photo and your answers are kept — press "Retry upload".',
  photoFinished: (count: number) => `Done, photos uploaded: ${count}.`,
  photoDescription: (date?: { label: string; exact: boolean }, place?: string) =>
    [
      "Scanned paper photo.",
      date ? `Date: ${date.exact ? "" : "about "}${date.label}.` : "Date unknown.",
      place ? `Place: ${place}.` : undefined,
    ]
      .filter(Boolean)
      .join(" "),

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
    chat: (id: number, allowed: boolean) =>
      allowed
        ? `This chat (${id}) is in ALLOWED_CHAT_IDS: everyone here may use the bot.`
        : `This chat's ID: ${id}. Add it to ALLOWED_CHAT_IDS to let everyone here use the bot.`,
  },

  btn: {
    startScan: "📄 Scan",
    startPrint: "🖨 Print",
    startPhoto: "🖼 Photo → Immich",
    photoScan: "📷 Scan",
    photoDone: "🏁 Finish",
    photoRotate: "🔄 Rotate",
    photoRescan: "🔁 Rescan",
    photoNext: "✅ Next",
    photoDrop: "🗑 Discard",
    placeOk: "✅ Yes",
    placeRetry: "✏️ Another place",
    uploadRetry: "🔁 Retry upload",
    placeNoGeo: "📝 Without coordinates",
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
