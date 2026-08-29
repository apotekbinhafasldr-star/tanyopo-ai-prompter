import type { Metadata } from "next";
import { ComingSoon } from "@/components/shared/coming-soon";
import { requireSessionContext } from "@/services/session";

export const metadata: Metadata = { title: "Content — Tanyopo AI Promoter" };

export default async function ContentPage() {
  await requireSessionContext();
  return (
    <ComingSoon
      title="Content Studio"
      description="AI content generator, content library, dan kalender publikasi."
      phase="Phase 1 — Core Promoter"
    />
  );
}
