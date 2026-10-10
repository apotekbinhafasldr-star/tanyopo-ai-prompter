import type { Metadata } from "next";

/**
 * Shared facts + metadata for the public legal pages (/privacy, /terms,
 * /data-deletion).
 *
 * Only facts the Founder supplied, or that the code demonstrably does, live
 * here. Anything legal/operational that is NOT yet decided (contact channel,
 * retention periods, deletion SLA, refund policy, ...) is deliberately NOT
 * invented: the pages render an explicit "menunggu keputusan perusahaan"
 * note instead (see <PendingDecision> in legal-parts.tsx).
 */
export const LEGAL = {
  operator: "PT Tanyopo Future Technology",
  location: "Ladang Rimba, Aceh Selatan, Indonesia",
  product: "LINOE by Tanyopo",
  /** Date this draft text was written. Not an "effective date". */
  draftDate: "10 Oktober 2026",
  /**
   * While true, the pages are labelled DRAF and asked NOT to be indexed by
   * search engines. Flip to false only after the Founder / legal counsel has
   * reviewed and approved the text for publication.
   */
  isDraft: true,
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
    robots: LEGAL.isDraft ? { index: false, follow: true } : { index: true, follow: true },
  };
}
