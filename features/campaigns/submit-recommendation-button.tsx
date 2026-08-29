"use client";

import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { submitRecommendationAsApprovalAction } from "@/features/campaigns/optimization-actions";
import type { Channel, OptimizationActionType, RiskLevel } from "@/types/database";

export function SubmitRecommendationButton({
  masterCampaignId,
  channel,
  actionType,
  suggestedDailyBudget,
  rationale,
  riskLevel,
}: {
  masterCampaignId: string;
  channel: Channel;
  actionType: OptimizationActionType;
  suggestedDailyBudget: number | null;
  rationale: string;
  riskLevel: RiskLevel;
}) {
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [pending, startTransition] = useTransition();

  if (submitted) {
    return <p className="text-xs text-success">Diajukan ke Approval Center.</p>;
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant="outline"
        loading={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await submitRecommendationAsApprovalAction(
              masterCampaignId,
              channel,
              actionType,
              suggestedDailyBudget,
              rationale,
              riskLevel,
            );
            if (result.error) {
              setError(result.error);
            } else {
              setSubmitted(true);
            }
          });
        }}
      >
        <Send />
        Ajukan untuk Persetujuan
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
