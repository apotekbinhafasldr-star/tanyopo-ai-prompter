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
   * "Berlaku sejak" date, set to the date of the Paket 1 draft (25 Nov 2026). The Founder confirms the final
   * date when merging. It does NOT mean the text is already published: it takes effect for users only once this
   * change is merged and deployed.
   */
  effectiveDate: "25 November 2026" as string | undefined,
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
