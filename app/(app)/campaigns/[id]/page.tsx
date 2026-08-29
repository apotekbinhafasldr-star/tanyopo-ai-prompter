import type { Metadata } from "next";
import { ComingSoon } from "@/components/shared/coming-soon";
import { requireSessionContext } from "@/services/session";

export const metadata: Metadata = { title: "Detail Campaign — Tanyopo AI Promoter" };

export default async function CampaignDetailPage() {
  await requireSessionContext();
  return (
    <ComingSoon
      title="Detail Campaign"
      description="Rincian channel campaign, creative, budget, dan performa."
      phase="Phase 2 — Marketing Operations"
    />
  );
}
