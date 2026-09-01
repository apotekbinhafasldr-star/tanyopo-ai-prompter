import type { Locale } from "@/types/database";

/**
 * Initial supported UI languages (product spec §3). Indonesia remains
 * first-class — DEFAULT_LOCALE is 'id' so every pre-Global-Edition tenant
 * (default_language backfilled to nothing, since the column already
 * existed and already defaulted to 'id' since Phase 0) sees no change.
 * Adding a third language later means: one more dictionary file
 * (lib/i18n/dictionaries/<code>.ts), one more entry in SUPPORTED_LOCALES,
 * and widening the `Locale` type/prompter_brand_profiles.default_language
 * CHECK constraint — nothing structural changes.
 */
export const SUPPORTED_LOCALES: readonly Locale[] = ["id", "en"];
export const DEFAULT_LOCALE: Locale = "id";

export function isSupportedLocale(value: string | null | undefined): value is Locale {
  return SUPPORTED_LOCALES.includes(value as Locale);
}
