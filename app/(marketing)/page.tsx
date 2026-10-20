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
import { DemoUnavailableNotice } from "@/features/marketing/components/demo-unavailable-notice";

export const metadata: Metadata = {
  title: "LINOE — AI Marketing & Growth Platform by Tanyopo",
  description:
    "LINOE membantu Anda menganalisis produk, menyusun strategi, membuat konten, menyiapkan campaign, memantau hasil, dan mengoptimasi pertumbuhan — semua dengan AI dalam satu platform.",
};

export default function LandingPage() {
  return (
    <>
      <DemoUnavailableNotice />
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
