import type { Locale } from "@/types/database";

/**
 * A curated (not exhaustive — the underlying schema/DB column accepts
 * any well-formed ISO 3166-1 alpha-2 code via regex, see
 * schemas/global-preferences.ts) list of quick-pick countries: Southeast
 * Asia (Tanyopo's home region) plus other major markets named in the
 * product spec's own examples (Indonesia/Malaysia, United States/
 * Singapore, United Kingdom). Never presented as "every country" —
 * a business outside this list can still enter its own code, it just
 * won't have a preset option here yet.
 */
export const QUICK_PICK_COUNTRY_CODES = [
  "ID", "MY", "SG", "TH", "VN", "PH", "US", "GB", "AU", "CA", "DE", "FR", "NL", "JP", "KR", "IN", "AE",
] as const;

/** Real CLDR country names via Intl.DisplayNames — never a hand-written/
 * fabricated translation, and locale-aware for free. */
export function countryLabel(countryCode: string, locale: Locale = "id"): string {
  try {
    const displayNames = new Intl.DisplayNames([locale === "en" ? "en" : "id"], { type: "region" });
    return displayNames.of(countryCode.toUpperCase()) ?? countryCode;
  } catch {
    return countryCode;
  }
}
