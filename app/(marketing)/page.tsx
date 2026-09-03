import type { Metadata } from "next";
import {
  Hero,
  HowItWorks,
  AiTeam,
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
  title: "Tanyopo AI Promoter — Tim Marketing AI untuk Bisnis Anda",
};

export default function LandingPage() {
  return (
    <>
      <Hero />
      <AiTeam />
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
