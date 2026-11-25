import type { Metadata } from "next";
import { OG_IMAGE } from "@/lib/seo/og";

/**
 * Shared facts + metadata for the public legal pages (/privacy, /terms,
 * /refund, /data-deletion).
 *
 * Only facts the Founder supplied, or that the code demonstrably does, live
 * here. Do not add operational retention periods, response-time promises (SLA), certifications, server locations,
 * or a formal PDP officer designation until they are decided and verified.
 */
export const LEGAL = {
  operator: "PT Tanyopo Future Technology",
  /** Public company location, approved by the Founder. */
  location: "Ladang Rimba, Aceh Selatan, Indonesia",
  contactEmail: "tanyopofuturetechnology@gmail.com",
  product: "LINOE by Tanyopo",
  /**
   * "Berlaku sejak" date. Deliberately left undefined: it must equal the date the text is actually live in
   * production, not the date of a merge or draft. While undefined, no date is rendered (no false date).
   * After the Founder-approved production deploy, a one-line change sets the real publication date.
   */
  effectiveDate: undefined as string | undefined,
} as const;

export const LEGAL_LINKS = [
  { href: "/privacy", label: "Kebijakan Privasi" },
  { href: "/terms", label: "Syarat & Ketentuan" },
  { href: "/refund", label: "Kebijakan Refund" },
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
      url: opts.path,
      type: "website",
      locale: "id_ID",
      siteName: "LINOE by Tanyopo",
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: `${opts.title} — LINOE by Tanyopo`,
      description: opts.description,
      images: [OG_IMAGE.url],
    },
    robots: { index: true, follow: true },
  };
}
