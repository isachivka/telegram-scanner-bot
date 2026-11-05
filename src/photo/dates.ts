/**
 * Parse how people say when an old photo was taken: "12.05.1987", "май 1987",
 * "лето 87", "1987", "80-е", "конец 70-х", "1990s", "summer 1985"…
 *
 * The result is a concrete date for the library timeline (noon UTC, so no time
 * zone moves it to another day) plus the words as given, which go into the
 * description so the precision is not lost.
 */

export type DatePrecision = "day" | "month" | "season" | "year" | "decade";

export interface ApproxDate {
  /** YYYY-MM-DD */
  date: string;
  precision: DatePrecision;
  /** What the person wrote, tidied: "лето 1987". */
  label: string;
}

const MONTHS: Array<[RegExp, number]> = [
  [/^(январ|янв|jan)/, 1],
  [/^(феврал|фев|feb)/, 2],
  [/^(март|мар|mar)/, 3],
  [/^(апрел|апр|apr)/, 4],
  [/^(ма[йяе]|may)/, 5],
  [/^(июн|jun)/, 6],
  [/^(июл|jul)/, 7],
  [/^(август|авг|aug)/, 8],
  [/^(сентябр|сен|sep)/, 9],
  [/^(октябр|окт|oct)/, 10],
  [/^(ноябр|ноя|nov)/, 11],
  [/^(декабр|дек|dec)/, 12],
];

/** Season → month that represents it. */
const SEASONS: Array<[RegExp, number]> = [
  [/^(зим|winter)/, 1],
  [/^(весн|spring)/, 4],
  [/^(лет|summer)/, 7],
  [/^(осен|autumn|fall)/, 10],
];

const pad = (n: number) => String(n).padStart(2, "0");

function fullYear(raw: string, now: Date): number | undefined {
  const n = Number(raw);
  if (!Number.isInteger(n)) return undefined;
  if (raw.length === 4) return n >= 1826 && n <= now.getFullYear() ? n : undefined;
  if (raw.length === 2) {
    const century = n <= now.getFullYear() % 100 ? 2000 : 1900;
    return century + n;
  }
  return undefined;
}

function validDay(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function parseApproxDate(input: string, now = new Date()): ApproxDate | undefined {
  const label = input.trim().replace(/\s+/g, " ");
  const s = label
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[~≈]/g, " ")
    // JS \b does not see Cyrillic letters, so words are delimited by spaces.
    .replace(
      /(^|\s)(примерно|приблизительно|около|где-то|наверное|вроде|в|во|in|годы|годах|годов|года|год|гг?\.?|circa|ca\.?|about|around|approx\.?)(?=\s|$)/g,
      " ",
    )
    .replace(
      /(^|\s)(примерно|приблизительно|около|где-то|наверное|вроде|в|во|in)(?=\s|$)/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return undefined;

  const make = (y: number, m: number, d: number, precision: DatePrecision) =>
    ({ date: `${y}-${pad(m)}-${pad(d)}`, precision, label }) satisfies ApproxDate;

  // ISO 1987-05-12
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const y = fullYear(m[1]!, now);
    if (y && validDay(y, +m[2]!, +m[3]!)) return make(y, +m[2]!, +m[3]!, "day");
    return undefined;
  }
  // 12.05.1987, 12/05/87, 12-05-1987
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (m) {
    const y = fullYear(m[3]!, now);
    if (y && validDay(y, +m[2]!, +m[1]!)) return make(y, +m[2]!, +m[1]!, "day");
    return undefined;
  }
  // 05.1987, 5/87
  m = s.match(/^(\d{1,2})[./-](\d{4}|\d{2})$/);
  if (m) {
    const y = fullYear(m[2]!, now);
    const mo = +m[1]!;
    if (y && mo >= 1 && mo <= 12) return make(y, mo, 1, "month");
    return undefined;
  }

  // Decades: 80-е, 80е, 1980-е, 80-х, 1980s, 80s, plus начало/середина/конец.
  m = s.match(
    /^(?:(начал[оае]|ранние|early|середин[аые]|mid|кон[ец]ц?[ае]?|поздние|late)\s+)?(\d{2}|\d{4})\s*-?\s*(?:е|х|ые|ых|s|'s)$/,
  );
  if (m) {
    const raw = m[2]!;
    const y = fullYear(raw, now);
    if (y === undefined || y % 10 !== 0) return undefined;
    const part = m[1] ?? "";
    const offset = /^(начал|ранн|early)/.test(part)
      ? 2
      : /^(кон|поздн|late)/.test(part)
        ? 8
        : 5;
    return make(y + offset, 1, 1, "decade");
  }

  // "<month|season> <year>" and "<day> <month> <year>"
  m = s.match(/^(?:(\d{1,2})\s+)?([a-zа-я]+)\.?\s+(\d{4}|\d{2})$/);
  if (m) {
    const y = fullYear(m[3]!, now);
    if (!y) return undefined;
    const word = m[2]!;
    const month = MONTHS.find(([re]) => re.test(word))?.[1];
    if (month) {
      if (m[1]) {
        const d = +m[1];
        return validDay(y, month, d) ? make(y, month, d, "day") : undefined;
      }
      return make(y, month, 1, "month");
    }
    const season = SEASONS.find(([re]) => re.test(word))?.[1];
    if (season && !m[1]) return make(y, season, 1, "season");
    return undefined;
  }

  // A bare year: 1987 or 87.
  m = s.match(/^(\d{4}|\d{2})$/);
  if (m) {
    const y = fullYear(m[1]!, now);
    return y ? make(y, 1, 1, "year") : undefined;
  }
  return undefined;
}

/** "Don't know" in the forms people actually type. */
export function isUnknownAnswer(input: string): boolean {
  return /^\s*(-+|—|–|\?+|нет|не знаю|незнаю|хз|без даты|без места|пропустить|skip|no|none|unknown|don'?t know|idk)\s*[.!]*\s*$/i.test(
    input,
  );
}

/** "Same as the previous photo". */
export function isSameAnswer(input: string): boolean {
  return /^\s*(=+|так же|также|то же|тоже|same|ditto)\s*[.!]*\s*$/i.test(input);
}
