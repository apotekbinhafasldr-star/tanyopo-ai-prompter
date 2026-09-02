/**
 * Presentation-only brand metadata for the public marketing site.
 *
 * Centralized so a future rebrand (e.g. Linoe / Linoe.ai) only needs to
 * change this one file — never database identifiers, env vars, routes,
 * API contracts, or the repository/product name used internally. Product
 * spec: keep "Tanyopo AI Promoter" as the actual product identity for now;
 * this file exists purely to avoid the display name being hand-typed in
 * a dozen components.
 */
export const brand = {
  name: "Tanyopo AI Promoter",
  shortName: "Tanyopo",
  parentCompany: "Tanyopo Labs",
  initial: "T",
  tagline: {
    id: "Ubah Produk Menjadi Pertumbuhan.",
    en: "Turn Your Product Into Growth.",
  },
  description:
    "Tim marketing AI untuk bisnis Anda — dari produk hingga campaign, konten, analisis, dan optimasi dalam satu platform.",
} as const;
