import type { Metadata } from "next";
import { ComingSoon } from "@/components/shared/coming-soon";
import { requireSessionContext } from "@/services/session";

export const metadata: Metadata = { title: "Billing — Tanyopo AI Promoter" };

export default async function BillingPage() {
  await requireSessionContext();
  return (
    <ComingSoon
      title="Billing"
      description="Paket langganan, penggunaan, dan riwayat tagihan."
      phase="Phase 2+ — Marketing Operations"
    />
  );
}
