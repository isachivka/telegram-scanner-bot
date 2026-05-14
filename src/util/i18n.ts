export const t = {
  welcome:
    "Привет! Я бот для сканирования. Нажми «Начать сканирование», чтобы открыть сессию.",
  mainMenu: "Главное меню",
  sessionStarted: (mode: string, dpi: number, pages: number) =>
    `Сессия сканирования.\nРежим: ${mode === "Color" ? "цветной" : "серый"}\nDPI: ${dpi}\nСтраниц: ${pages}`,
  scanning: "Сканирую страницу…",
  pageScanned: (n: number) => `Готово! Отсканировано страниц: ${n}`,
  scanFailed: (err: string) => `Ошибка сканирования: ${err}`,
  nothingToFinish: "Нет страниц. Сначала отсканируй хотя бы одну.",
  buildingPdf: "Собираю PDF…",
  done: (pages: number) => `Готово, ${pages} стр.`,
  cancelled: "Сессия отменена.",
  unauthorized: (id: number) =>
    `Доступ запрещён.\nТвой Telegram user ID: ${id}\nДобавь его в ALLOWED_USER_IDS и перезапусти бота.`,
  busy: "Идёт сканирование, подожди.",
} as const;

export const btn = {
  startScan: "📄 Начать сканирование",
  scanPage: "➕ Сканировать страницу",
  finish: "✅ Завершить сканирование",
  cancel: "❌ Отмена",
  toggleMode: (mode: string) =>
    mode === "Color" ? "🎨 Режим: цветной" : "⚫ Режим: серый",
  cycleDpi: (dpi: number) => `🔍 DPI: ${dpi}`,
} as const;
