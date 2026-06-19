export type Locale = "en" | "ja";

export function detectLocale(request: Request): Locale {
  const url = new URL(request.url);
  const param = url.searchParams.get("locale") || "";
  return param.startsWith("ja") ? "ja" : "en";
}

type TranslationMap = Record<string, string>;

const en: TranslationMap = {
  // ── Step 2: static labels ──────────────────────────────────────────────
  // ── Step 3: modal ─────────────────────────────────────────────────────
  // ── Step 4: buttons / toasts ──────────────────────────────────────────
};

const ja: TranslationMap = {
  // ── Step 2: static labels ──────────────────────────────────────────────
  // ── Step 3: modal ─────────────────────────────────────────────────────
  // ── Step 4: buttons / toasts ──────────────────────────────────────────
};

const translations: Record<Locale, TranslationMap> = { en, ja };

/** Return the translated string for key, falling back to English then the key itself. */
export function t(key: string, locale: Locale): string {
  return translations[locale]?.[key] ?? translations.en[key] ?? key;
}
