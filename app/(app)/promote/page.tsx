import type { Metadata } from "next";
import { ComingSoon } from "@/components/shared/coming-soon";
import { requireSessionContext } from "@/services/session";

export const metadata: Metadata = { title: "Promote — Tanyopo AI Promoter" };

export default async function PromotePage() {
  await requireSessionContext();
  return (
    <ComingSoon
      title="Promote"
      description="Alur wizard AI untuk membuat strategi, konten, dan campaign dari produk Anda."
      phase="Phase 1 — Core Promoter"
    />
  );
}
