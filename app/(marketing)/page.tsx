import type { Metadata } from "next";
import {
  Hero,
  HowItWorks,
  Capabilities,
  Channels,
  Audiences,
  UmkmproIntegration,
  Security,
  PricingTeaser,
  FinalCta,
} from "@/features/marketing/sections";

export const metadata: Metadata = {
  title: "Tanyopo AI Promoter — Tim Marketing AI untuk Bisnis Anda",
};

export default function LandingPage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <Capabilities />
      <Channels />
      <Audiences />
      <UmkmproIntegration />
      <Security />
      <PricingTeaser />
      <FinalCta />
    </>
  );
}
