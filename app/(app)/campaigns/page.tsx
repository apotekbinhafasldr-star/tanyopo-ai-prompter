import type { Metadata } from "next";
import { ComingSoon } from "@/components/shared/coming-soon";
import { requireSessionContext } from "@/services/session";

export const metadata: Metadata = { title: "Campaigns — Tanyopo AI Promoter" };

export default async function CampaignsPage() {
  await requireSessionContext();
  return (
    <ComingSoon
      title="Campaigns"
      description="Kelola master campaign lintas channel: status, spend, revenue, dan ROAS."
      phase="Phase 2 — Marketing Operations"
    />
  );
}
