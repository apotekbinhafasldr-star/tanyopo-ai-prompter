import type { Metadata } from "next";
import { OnboardingWizard } from "@/features/onboarding/onboarding-wizard";

export const metadata: Metadata = {
  title: "Onboarding — Tanyopo AI Promoter",
};

export default function OnboardingPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-4 py-12">
      <div className="flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-[var(--radius-md)] bg-brand text-sm font-bold text-brand-foreground">
          T
        </span>
        <span className="text-sm font-semibold tracking-tight text-foreground">
          Tanyopo AI Promoter
        </span>
      </div>
      <OnboardingWizard />
    </div>
  );
}
