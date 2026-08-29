"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { regenerateCampaignProposalAction } from "@/features/campaigns/actions";

export function RegenerateProposalButton({ campaignId }: { campaignId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="secondary"
        size="sm"
        loading={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await regenerateCampaignProposalAction(campaignId);
            if (result.error) setError(result.error);
          });
        }}
      >
        <RefreshCw />
        Buat Ulang dengan AI
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
