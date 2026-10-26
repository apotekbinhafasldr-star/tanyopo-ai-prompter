import type { Metadata } from "next";
import {
  Hero,
  TanyopoIntelligence,
  IdeToResult,
  DeviceShowcase,
  HowItWorks,
  AiTeam,
  AdPersonaBridge,
  Omnichannel,
  AnalyticsShowcase,
  ProfitAware,
  UmkmproIntegration,
  GlobalEdition,
  Trust,
  Pricing,
  Faq,
  FinalCta,
} from "@/features/marketing/sections";
import { OG_IMAGE, SITE_DESCRIPTION, SITE_TITLE } from "@/lib/seo/og";
import { buildLandingJsonLd, serializeJsonLd } from "@/lib/seo/json-ld";
import { getSiteOrigin } from "@/lib/seo/site-url";

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
    siteName: "LINOE",
    locale: "id_ID",
    type: "website",
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE.url],
  },
};

export default function LandingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(buildLandingJsonLd(getSiteOrigin())) }}
      />
      <Hero />
      <TanyopoIntelligence />
      <IdeToResult />
      <DeviceShowcase />
      <AiTeam />
      <AdPersonaBridge />
      <HowItWorks />
      <Omnichannel />
      <AnalyticsShowcase />
      <ProfitAware />
      <UmkmproIntegration />
      <GlobalEdition />
      <Trust />
      <Pricing />
      <Faq />
      <FinalCta />
    </>
  );
}
