import type { Metadata } from "next";
import { ComingSoon } from "@/components/shared/coming-soon";
import { requireSessionContext } from "@/services/session";

export const metadata: Metadata = { title: "SEO — Tanyopo AI Promoter" };

export default async function SeoPage() {
  await requireSessionContext();
  return (
    <ComingSoon
      title="SEO"
      description="Rekomendasi keyword, on-page, dan content plan untuk website Anda."
      phase="Phase 5 — Growth + SEO"
    />
  );
}
