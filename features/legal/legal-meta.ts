import type { Metadata } from "next";

/**
 * Shared facts + metadata for the public legal pages (/privacy, /terms,
 * /data-deletion).
 *
 * Only facts the Founder supplied, or that the code demonstrably does, live
 * here. Do not add retention periods, response-time promises (SLA), refund
 * terms, certifications or server locations until they are decided and
 * verified.
 */
export const LEGAL = {
  operator: "PT Tanyopo Future Technology",
  /**
   * CANDIDATE address. It must be confirmed by the Founder before the pages
   * are published; remove this field (and its use in LegalDocument) if the
   * address should not be shown.
   */
  location: "Ladang Rimba, Aceh Selatan, Indonesia",
  contactEmail: "tanyopofuturetechnology@gmail.com",
  product: "LINOE by Tanyopo",
  /**
   * "Berlaku sejak" date. Intentionally unset: set it to the real date on
   * which the Founder approves publication. While undefined, no effective
   * date is rendered.
   */
  effectiveDate: undefined as string | undefined,
} as const;

export const LEGAL_LINKS = [
  { href: "/privacy", label: "Kebijakan Privasi" },
  { href: "/terms", label: "Syarat & Ketentuan" },
  { href: "/data-deletion", label: "Penghapusan Data" },
] as const;

export function legalMetadata(opts: { title: string; description: string; path: string }): Metadata {
  return {
    title: `${opts.title} — LINOE`,
    description: opts.description,
    alternates: { canonical: opts.path },
    openGraph: {
      title: `${opts.title} — LINOE by Tanyopo`,
      description: opts.description,
      type: "website",
      locale: "id_ID",
      siteName: "LINOE by Tanyopo",
    },
    robots: { index: true, follow: true },
  };
}
