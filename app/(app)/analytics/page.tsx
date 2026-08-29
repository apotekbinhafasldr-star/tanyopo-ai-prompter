import type { Metadata } from "next";
import { ComingSoon } from "@/components/shared/coming-soon";
import { requireSessionContext } from "@/services/session";

export const metadata: Metadata = { title: "Analytics — Tanyopo AI Promoter" };

export default async function AnalyticsPage() {
  await requireSessionContext();
  return (
    <ComingSoon
      title="Analytics"
      description="Spend, konversi, revenue, dan ROAS lintas channel — dari data nyata, bukan simulasi."
      phase="Phase 2 — Marketing Operations"
    />
  );
}
