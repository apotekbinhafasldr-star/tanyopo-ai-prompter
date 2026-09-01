"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateOptimizationRecommendationsAction } from "@/features/campaigns/optimization-actions";

export function GenerateOptimizationButton({
  masterCampaignId,
  hasExisting,
}: {
  masterCampaignId: string;
  hasExisting: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant={hasExisting ? "secondary" : "primary"}
        size="sm"
        loading={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await generateOptimizationRecommendationsAction(masterCampaignId);
            if (result.error) setError(result.error);
          });
        }}
      >
        <Sparkles />
        {hasExisting ? "Buat Ulang Rekomendasi" : "Buat Rekomendasi Optimasi"}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
