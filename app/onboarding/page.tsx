import type { Metadata } from "next";
import { OnboardingWizard } from "@/features/onboarding/onboarding-wizard";
import { LinoeLogo } from "@/components/brand/linoe-logo";

export const metadata: Metadata = {
  title: "Onboarding — LINOE",
};

export default function OnboardingPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-4 py-12">
      <LinoeLogo href={null} />
      <OnboardingWizard />
    </div>
  );
}
