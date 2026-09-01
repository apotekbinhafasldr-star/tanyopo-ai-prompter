import type { Dictionary } from "@/lib/i18n/dictionary";

/**
 * English dictionary. Must satisfy the exact same shape as id.ts
 * (enforced by the Dictionary type) — TypeScript fails to compile if a
 * key exists in one locale but not the other, which is the "no missing
 * translation slips through" guarantee this pass can actually make.
 */
const en: Dictionary = {
  common: {
    save: "Save",
    cancel: "Cancel",
    next: "Next",
    back: "Back",
    skip: "Skip",
    optional: "optional",
    loading: "Loading...",
  },
  settings: {
    languageTitle: "Language",
    languageDescription: "Interface language and the default language for AI-generated content.",
    languageSaved: "Language saved.",
    languageError: "Failed to save language.",
  },
  onboarding: {
    globalStepTitle: "Market & Global Preferences",
    countryLabel: "Business country",
    countryDescription: "The country your business operates from (your home market).",
    languageLabel: "Language",
    timezoneLabel: "Timezone",
    currencyLabel: "Default currency",
    targetMarketLabel: "Campaign target market (optional)",
    targetMarketDescription:
      "If your campaign target differs from your business country (e.g. business in Indonesia, campaign targeting Malaysia), set it here. Leave blank if it's the same as your business country.",
  },
};

export default en;
