import type { Metadata } from "next";
import { ComingSoon } from "@/components/shared/coming-soon";
import { requireSessionContext } from "@/services/session";

export const metadata: Metadata = { title: "Products — Tanyopo AI Promoter" };

export default async function ProductsPage() {
  await requireSessionContext();
  return (
    <ComingSoon
      title="Products"
      description="Katalog produk, jasa, aplikasi, dan langganan yang ingin Anda promosikan."
      phase="Phase 1 — Core Promoter"
    />
  );
}
