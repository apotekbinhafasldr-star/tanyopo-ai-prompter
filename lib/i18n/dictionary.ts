import type { Locale } from "@/types/database";
import { DEFAULT_LOCALE, isSupportedLocale } from "@/lib/i18n/config";

/**
 * The shape every locale dictionary must satisfy — declared once here
 * (not derived via `typeof` from one locale's own const object, which
 * would pin every other locale to that locale's exact string literals
 * instead of just requiring "a string"). Both id.ts and en.ts declare
 * `const <locale>: Dictionary = {...}`, so a missing or misspelled key
 * in either one is a compile error.
 */
export interface Dictionary {
  common: {
    save: string;
    cancel: string;
    next: string;
    back: string;
    skip: string;
    optional: string;
    loading: string;
  };
  settings: {
    languageTitle: string;
    languageDescription: string;
    languageSaved: string;
    languageError: string;
  };
  onboarding: {
    globalStepTitle: string;
    countryLabel: string;
    countryDescription: string;
    languageLabel: string;
    timezoneLabel: string;
    currencyLabel: string;
    targetMarketLabel: string;
    targetMarketDescription: string;
  };
}

const DICTIONARIES: Record<Locale, () => Promise<Dictionary>> = {
  id: async () => (await import("@/lib/i18n/dictionaries/id")).default,
  en: async () => (await import("@/lib/i18n/dictionaries/en")).default,
};

/**
 * Resolves a locale's dictionary. Falls back to DEFAULT_LOCALE's
 * dictionary for an unsupported/unknown locale string — this is the
 * "fallback language behavior" requirement (product spec §3): a bad or
 * unrecognized locale value never crashes a page, it just renders
 * Indonesian, same as every page already did before Global Edition.
 */
export async function getDictionary(locale: string | null | undefined): Promise<Dictionary> {
  const resolved = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
  return DICTIONARIES[resolved]();
}
