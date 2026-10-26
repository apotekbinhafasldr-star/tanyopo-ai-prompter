import { FAQS } from "@/features/marketing/faq-data";
import { LEGAL } from "@/features/legal/legal-meta";
import { OG_IMAGE } from "@/lib/seo/og";

/**
 * Structured data (JSON-LD) for the public landing page only.
 *
 * Accuracy rules: only facts already public on the site (LEGAL constants,
 * landing FAQ, 14-day trial). No offers/prices (online payment is not live),
 * no rating/review, no phone/social accounts, no certifications, no
 * organisation logo (the LINOE logo is a product mark, not verified as the
 * legal entity's logo). No tenant/user data ever enters this module.
 */
export const JSON_LD_DESCRIPTION =
  "Platform AI untuk membantu analisis produk, strategi pemasaran, persiapan konten, dan persiapan kampanye pemasaran. Tersedia trial gratis 14 hari.";

export function buildLandingJsonLd(origin: string) {
  const orgId = `${origin}/#organization`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": orgId,
        name: LEGAL.operator,
        url: origin,
        email: LEGAL.contactEmail,
        address: LEGAL.location,
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${origin}/#software`,
        name: "LINOE",
        alternateName: LEGAL.product,
        url: origin,
        description: JSON_LD_DESCRIPTION,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        inLanguage: "id",
        image: `${origin}${OG_IMAGE.url}`,
        publisher: { "@id": orgId },
      },
      {
        "@type": "FAQPage",
        "@id": `${origin}/#faq`,
        mainEntity: FAQS.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };
}

/** JSON.stringify that is safe to inline in a <script> tag (no </script>, no HTML injection). */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(new RegExp("\\u2028", "g"), "\\u2028")
    .replace(new RegExp("\\u2029", "g"), "\\u2029");
}
