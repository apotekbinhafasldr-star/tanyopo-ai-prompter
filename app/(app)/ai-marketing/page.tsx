import type { Metadata } from "next";
import { ComingSoon } from "@/components/shared/coming-soon";
import { requireSessionContext } from "@/services/session";

export const metadata: Metadata = { title: "AI Marketing — LINOE" };

export default async function AiMarketingPage() {
  await requireSessionContext();
  return (
    <ComingSoon
      title="AI Marketing Chat"
      description="Copilot AI dengan konteks produk, campaign, dan metrik tenant Anda."
      phase="Phase 7 — Advanced AI"
    />
  );
}
