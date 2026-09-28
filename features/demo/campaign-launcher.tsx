"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Megaphone, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { launchDemoCampaignAction, type DemoCampaignLaunchResult } from "@/features/demo/campaign-actions";
import { DEMO_CAMPAIGN } from "@/lib/demo/dataset";

/**
 * Mirrors the real Approval Center → campaign-launch flow at a UX level
 * (Ajukan Approval → Setuju & Luncurkan), but both steps here only ever
 * touch launchDemoCampaignAction — a fully simulated, no-network action.
 * There is no real prompter_approvals row and no real
 * prompter_channel_campaigns row anywhere in this flow.
 */
export function DemoCampaignLauncher() {
  const [stage, setStage] = useState<"draft" | "pending_approval" | "launched">("draft");
  const [result, setResult] = useState<DemoCampaignLaunchResult | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-6">
        <div>
          <p className="text-sm font-semibold text-foreground">{DEMO_CAMPAIGN.name}</p>
          <p className="text-sm text-muted-foreground">
            Budget harian Rp{DEMO_CAMPAIGN.dailyBudget.toLocaleString("id-ID")} &middot; {DEMO_CAMPAIGN.durationDays} hari
          </p>
        </div>

        {stage === "draft" && (
          <Button onClick={() => setStage("pending_approval")}>
            <ShieldCheck className="size-4" aria-hidden />
            Ajukan untuk Approval
          </Button>
        )}

        {stage === "pending_approval" && (
          <div className="flex flex-col gap-3">
            <Badge variant="warning">Menunggu Approval (Simulasi)</Badge>
            <Button
              onClick={() =>
                startTransition(async () => {
                  const launchResult = await launchDemoCampaignAction();
                  setResult(launchResult);
                  setStage("launched");
                })
              }
              loading={isPending}
            >
              <Megaphone className="size-4" aria-hidden />
              Setuju &amp; Luncurkan Campaign
            </Button>
          </div>
        )}

        {stage === "launched" && result && (
          <div className="flex flex-col gap-2">
            <Badge variant="success">
              <CheckCircle2 className="size-3.5" aria-hidden />
              Campaign Aktif (Simulasi)
            </Badge>
            <p className="text-xs text-muted-foreground">
              ID campaign simulasi: {result.externalCampaignId} &middot; Tidak ada iklan nyata yang dijalankan dan
              tidak ada biaya yang dikenakan.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
