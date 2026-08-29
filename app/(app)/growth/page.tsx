import type { Metadata } from "next";
import { ComingSoon } from "@/components/shared/coming-soon";
import { requireSessionContext } from "@/services/session";

export const metadata: Metadata = { title: "Growth — Tanyopo AI Promoter" };

export default async function GrowthPage() {
  await requireSessionContext();
  return (
    <ComingSoon
      title="Follower Growth"
      description="Target dan roadmap pertumbuhan follower per platform — tanpa bot atau engagement palsu."
      phase="Phase 5 — Growth + SEO"
    />
  );
}
