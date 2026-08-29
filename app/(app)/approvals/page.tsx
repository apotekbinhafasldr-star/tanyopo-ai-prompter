import type { Metadata } from "next";
import { ComingSoon } from "@/components/shared/coming-soon";
import { requireSessionContext } from "@/services/session";

export const metadata: Metadata = { title: "Approvals — Tanyopo AI Promoter" };

export default async function ApprovalsPage() {
  await requireSessionContext();
  return (
    <ComingSoon
      title="Approval Center"
      description="Persetujuan peluncuran campaign, perubahan budget, dan aksi autopilot."
      phase="Phase 2 — Marketing Operations"
    />
  );
}
