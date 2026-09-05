import type { Metadata } from "next";
import {
  Hero,
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

export const metadata: Metadata = {
  title: "LINOE — AI Marketing & Growth Platform by Tanyopo",
  description:
    "LINOE membantu Anda menganalisis produk, menyusun strategi, membuat konten, menjalankan campaign, memantau hasil, dan mengoptimasi pertumbuhan — semua dengan AI dalam satu platform.",
};

export default function LandingPage() {
  return (
    <>
      <Hero />
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
