/**
 * Presentation-only brand metadata — customer-facing display strings ONLY.
 *
 * Product spec: the customer-facing brand is now LINOE (by Tanyopo). This
 * intentionally does NOT rename any technical identifier — the repository,
 * database tables (`prompter_*`), env vars, API routes/namespaces,
 * deployment IDs, and internal package name all remain
 * `tanyopo-ai-prompter` / `Tanyopo AI Promoter` for backward compatibility.
 * Only what a user actually reads on screen changes here.
 *
 * Centralized so the next rebrand (or a correction to this one) only needs
 * to change this one file — never a database identifier, env var, route,
 * API contract, or the repository/product name used internally.
 */
export const brand = {
  /** Primary customer-facing product name. */
  name: "LINOE",
  /** Full lockup for places with room for the parent attribution. */
  lockup: "LINOE by Tanyopo",
  shortName: "LINOE",
  parentCompany: "Tanyopo",
  /** Full ecosystem/company name for legal-ish footer text. */
  companyFull: "Tanyopo Labs",
  /** Logo mark initial/monogram fallback when the full mark can't render. */
  initial: "L",
  category: "AI Marketing & Growth Platform",
  intelligenceLayer: "Tanyopo Intelligence",
  tagline: {
    id: "Marketing Lebih Cepat. Bisnis Melaju Lebih Jauh.",
    en: "Faster Marketing. Further Growth.",
  },
  description:
    "LINOE membantu Anda menganalisis produk, menyusun strategi, membuat konten, menjalankan campaign, memantau hasil, dan mengoptimasi pertumbuhan — semua dengan AI dalam satu platform.",
  /** Legacy/internal name — never shown to customers, kept for code comments and technical contexts only. */
  legacyInternalName: "Tanyopo AI Promoter",
} as const;
