import type { Metadata } from "next";
import { ComingSoon } from "@/components/shared/coming-soon";
import { requireSessionContext } from "@/services/session";

export const metadata: Metadata = { title: "Detail Produk — Tanyopo AI Promoter" };

export default async function ProductDetailPage() {
  await requireSessionContext();
  return (
    <ComingSoon
      title="Detail Produk"
      description="Marketing blueprint, konten, campaign, dan analitik per produk."
      phase="Phase 1 — Core Promoter"
    />
  );
}
