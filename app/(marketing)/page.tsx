import type { Metadata } from "next";
import { Suspense } from "react";
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
import { DemoNotice } from "@/features/marketing/demo-notice";
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
      {/* JSON-LD: serialised with escaped "<" / ">" / "&" (lib/seo/json-ld.ts). */}
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(buildLandingJsonLd(getSiteOrigin())) }}
      />
      {/* Reads ?demo=busy|unavailable on the client; Suspense keeps the page static. */}
      <Suspense fallback={null}>
        <DemoNotice />
      </Suspense>
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
