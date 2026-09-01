/**
 * Indonesian dictionary — the pre-existing default language of every
 * string in this app. This file is the reference; en.ts (and any future
 * locale) must satisfy the same Dictionary type (lib/i18n/dictionary.ts),
 * so a missing translation is a compile error, not a silent runtime gap.
 *
 * Scope: this covers the language switcher and the new Global Edition
 * onboarding steps (country/language/timezone/currency/target market) —
 * the surfaces this pass actually wires up to the dictionary system, not
 * a placeholder translation of the entire app. See docs/ROADMAP.md
 * "Global Edition — i18n" for what's covered vs. what's still
 * hard-coded Indonesian.
 */
import type { Dictionary } from "@/lib/i18n/dictionary";

const id: Dictionary = {
  common: {
    save: "Simpan",
    cancel: "Batal",
    next: "Lanjut",
    back: "Kembali",
    skip: "Lewati",
    optional: "opsional",
    loading: "Memuat...",
  },
  settings: {
    languageTitle: "Bahasa",
    languageDescription: "Bahasa antarmuka dan bahasa default untuk konten yang dibuat AI.",
    languageSaved: "Bahasa berhasil disimpan.",
    languageError: "Gagal menyimpan bahasa.",
  },
  onboarding: {
    globalStepTitle: "Pasar & Preferensi Global",
    countryLabel: "Negara bisnis",
    countryDescription: "Negara tempat bisnis Anda beroperasi (pasar utama Anda).",
    languageLabel: "Bahasa",
    timezoneLabel: "Zona waktu",
    currencyLabel: "Mata uang default",
    targetMarketLabel: "Target pasar campaign (opsional)",
    targetMarketDescription:
      "Jika target campaign Anda berbeda dari negara bisnis (mis. bisnis di Indonesia, target campaign di Malaysia), pilih di sini. Kosongkan jika sama dengan negara bisnis.",
  },
};

export default id;
