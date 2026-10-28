import type { Metadata } from "next";
import { HelpCenter } from "@/features/help/help-center";
import { HELP_ARTICLES } from "@/features/help/help-content";
import { LEGAL } from "@/features/legal/legal-meta";
import { OG_IMAGE } from "@/lib/seo/og";
import { serializeJsonLd } from "@/lib/seo/json-ld";
import { getSiteOrigin } from "@/lib/seo/site-url";

const TITLE = "Pusat Bantuan — LINOE";
const DESCRIPTION =
  "Pusat Bantuan LINOE by Tanyopo: memulai, trial gratis 14 hari, paket dan batas, koneksi media sosial, kesiapan iklan, status pembayaran, refund, privasi, dan cara menghubungi dukungan.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/help" },
  openGraph: {
    title: "Pusat Bantuan — LINOE by Tanyopo",
    description: DESCRIPTION,
    url: "/help",
    type: "website",
    locale: "id_ID",
    siteName: "LINOE by Tanyopo",
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: "Pusat Bantuan — LINOE by Tanyopo",
    description: DESCRIPTION,
    images: [OG_IMAGE.url],
  },
  robots: { index: true, follow: true },
};

export default function HelpPage() {
  const origin = getSiteOrigin();
  // FAQPage structured data from the same articles the page renders (no prices, offers or ratings).
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${origin}/help#faq`,
    mainEntity: HELP_ARTICLES.map((a) => ({
      "@type": "Question",
      name: a.question,
      acceptedAnswer: { "@type": "Answer", text: a.answer },
    })),
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />
      <header className="mb-8">
        <p className="text-sm font-medium text-brand">{LEGAL.product}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Pusat Bantuan</h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          Jawaban untuk pertanyaan yang sering muncul. Setiap fitur diberi status yang jujur: sudah tersedia, dalam
          pengembangan, atau menunggu persetujuan platform.
        </p>
      </header>
      <HelpCenter />
    </div>
  );
}
