import type { Metadata } from "next";
import { ComingSoon } from "@/components/shared/coming-soon";
import { requireSessionContext } from "@/services/session";

export const metadata: Metadata = { title: "Connections — Tanyopo AI Promoter" };

export default async function ConnectionsPage() {
  await requireSessionContext();
  return (
    <ComingSoon
      title="Connection Center"
      description="Hubungkan Facebook, Instagram, TikTok, dan X. Status akan selalu jujur: CONNECTED hanya jika API benar-benar terhubung."
      phase="Phase 3 — Meta Foundation"
    />
  );
}
