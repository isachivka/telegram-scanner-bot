import type { Dictionary } from "./en.js";

const modeNames: Record<string, string> = {
  Color: "цветной",
  Gray: "серый",
  Lineart: "ч/б",
};
const modeName = (mode: string) => modeNames[mode] ?? mode;

export const ru: Dictionary = {
  commands: {
    start: "Открыть главное меню",
    cancel: "Отменить текущую сессию",
    status: "Состояние сканера и принтера",
  },
  welcome: "Привет! Я превращаю сканер в сервис «скан → PDF». Выбери действие.",
  mainMenu: "Главное меню",
  unauthorized: (id) =>
    `Доступ запрещён.\nТвой Telegram user ID: ${id}\nДобавь его в ALLOWED_USER_IDS и перезапусти бота.`,
  busy: "Сканер занят, подожди.",
  cancelled: "Сессия отменена.",

  session: (mode, dpi, pages) =>
    `Сессия сканирования\nРежим: ${modeName(mode)}\nDPI: ${dpi}\nСтраниц: ${pages}`,
  scanning: "Сканирую страницу…",
  scanningAdf: "Сканирую из податчика…",
  pageScanned: (n) => `Готово, отсканировано страниц: ${n}`,
  adfScanned: (added, total) => `Готово, из податчика: ${added}, всего: ${total}`,
  adfEmpty: "Податчик пуст.",
  scanFailed: (err) => `Ошибка сканирования: ${err}`,
  nothingToFinish: "Нет страниц. Сначала отсканируй хотя бы одну.",
  buildingPdf: "Собираю PDF…",
  pdfFailed: (err) => `Не удалось собрать PDF: ${err}`,
  done: (pages) => `Готово, ${pages} стр.`,

  printPrompt: (copies) =>
    `Режим печати\nКопий: ${copies}\nПришли PDF или картинку документом.`,
  printNeedsFile: "Пришли PDF или картинку (документом или фото).",
  printTooLarge: (mb) =>
    `Файл слишком большой (>${mb} MB). Telegram-бот не может его скачать.`,
  printSent: (jobId, copies) => `Отправлено в печать (job ${jobId}, копий: ${copies}).`,
  printFailed: (err) => `Ошибка печати: ${err}`,
  printDisabled: "Печать в этом боте не настроена.",

  status: {
    header: "Состояние",
    scannerDevice: (d) => `Устройство сканера: ${d}`,
    scannerAuto: "Устройство сканера: первое, которое найдёт SANE",
    devicesFound: (list) =>
      list.length
        ? `Устройства SANE:\n${list.map((d) => `• ${d}`).join("\n")}`
        : "Устройства SANE: не найдены",
    devicesError: (err) => `Устройства SANE: ошибка (${err})`,
    printerQueue: (q) => `Очередь печати: ${q}`,
    printerState: (s) => `Принтер: ${s}`,
    printerError: (err) => `Принтер: ошибка (${err})`,
    printerNone: "Принтер: не настроен",
    activeSessions: (n) => `Активных сессий сканирования: ${n}`,
  },

  btn: {
    startScan: "📄 Сканировать",
    startPrint: "🖨 Печать",
    scanPage: "➕ Страница",
    scanAdf: "📚 Из податчика",
    finish: "✅ Завершить",
    cancel: "❌ Отмена",
    mode: (mode) => `🎨 ${modeName(mode)}`,
    dpi: (dpi) => `🔍 ${dpi} dpi`,
    copies: (n) => `🧮 Копий: ${n}`,
    working: "⏳ Работаю…",
  },
};
