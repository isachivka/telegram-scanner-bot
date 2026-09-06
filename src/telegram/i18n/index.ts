import type { Language } from "../../config.js";
import { en, type Dictionary } from "./en.js";
import { ru } from "./ru.js";

const dictionaries: Record<Language, Dictionary> = { en, ru };

export type { Dictionary };

export function getDictionary(language: Language): Dictionary {
  return dictionaries[language];
}
