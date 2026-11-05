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

  photoDisabled: "Загрузка фотографий в Immich в этом боте не настроена.",
  photoNoKey: "Для твоего Telegram-аккаунта не задан ключ Immich (IMMICH_API_KEYS).",
  photoIntro: (dpi, album) =>
    `Бумажные фото → Immich (${dpi} dpi)\n\n` +
    `Положи ОДНУ фотографию на стекло лицом вниз, закрой крышку и нажми «Сканировать». ` +
    `Я обрежу белый фон, спрошу примерную дату и место и загружу фото в Immich` +
    `${album ? ` (альбом «${album}»)` : ""}.`,
  photoScanning: (dpi) => `Сканирую фото в ${dpi} dpi, это около 30 секунд…`,
  photoScanned: "Отсканировано.",
  photoPreview: "Вот что получилось. Если фото лежит боком — «Повернуть».",
  photoNotFound:
    "Не нашёл фотографию на стекле, поэтому это весь скан. Если нужно — поправь фото и нажми «Пересканировать».",
  photoReduced:
    "⚠️ В этот раз сканер не потянул высокое разрешение, поэтому фото в 300 dpi. Можно «Пересканировать» и попробовать ещё раз.",
  photoDropped: "Фото отброшено.",
  askDate: (hasPrevious, previous) =>
    "Когда примерно сделано фото?\n" +
    "Например: 1987, май 1987, лето 87, 12.05.1987, 80-е, конец 70-х.\n" +
    "Не знаешь — отправь «-»." +
    (hasPrevious
      ? `\nКак у прошлого фото (${previous ?? "неизвестно"}) — отправь «=».`
      : ""),
  dateNotUnderstood:
    "Не понял дату 🤔 Попробуй так: 1987, май 1987, лето 87, 12.05.1987, 80-е — или «-», если не знаешь.",
  askPlace: (hasPrevious, previous) =>
    "Где сделано фото? Город, место или адрес: «Сочи», «Москва, ВДНХ».\n" +
    "Не знаешь — отправь «-»." +
    (hasPrevious
      ? `\nКак у прошлого фото (${previous ?? "неизвестно"}) — отправь «=».`
      : ""),
  placeFound: (name) => `📍 Нашёл: ${name}\nВерно?`,
  placeNotFound: (query) =>
    `Не нашёл «${query}» на карте. Напиши иначе (лучше всего — город) или оставь без координат: тогда место просто запишется в описание фото.`,
  datePlaceholder: "например: лето 1987",
  placePlaceholder: "например: Сочи",
  uploading: "Загружаю в Immich…",
  uploaded: (link, count) =>
    `✅ Фото в Immich: ${link}\nЗа эту сессию: ${count}.\n\nКлади следующую и жми «Сканировать» — или «Закончить».`,
  albumFailed: (err) => `(Не получилось добавить в альбом: ${err})`,
  uploadFailed: (err) => `Не удалось загрузить в Immich: ${err}`,
  photoFinished: (count) => `Готово, загружено фото: ${count}.`,
  photoDescription: (date, place) =>
    [
      "Скан бумажной фотографии.",
      date ? `Дата: ${date.exact ? "" : "примерно "}${date.label}.` : "Дата неизвестна.",
      place ? `Место: ${place}.` : undefined,
    ]
      .filter(Boolean)
      .join(" "),

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
    chat: (id, allowed) =>
      allowed
        ? `Этот чат (${id}) в ALLOWED_CHAT_IDS: ботом могут пользоваться все участники.`
        : `ID этого чата: ${id}. Добавь его в ALLOWED_CHAT_IDS, чтобы ботом могли пользоваться все участники.`,
  },

  btn: {
    startScan: "📄 Сканировать",
    startPrint: "🖨 Печать",
    startPhoto: "🖼 Фото в Immich",
    photoScan: "📷 Сканировать",
    photoDone: "🏁 Закончить",
    photoRotate: "🔄 Повернуть",
    photoRescan: "🔁 Пересканировать",
    photoNext: "✅ Дальше",
    photoDrop: "🗑 Отбросить",
    placeOk: "✅ Да",
    placeRetry: "✏️ Другое место",
    placeNoGeo: "📝 Без координат",
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
