"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { syncChannelCampaignInsightsAction } from "@/features/campaigns/sync-insights-actions";

export function SyncInsightsButton({ channelCampaignId }: { channelCampaignId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="ghost"
        loading={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await syncChannelCampaignInsightsAction(channelCampaignId);
            if (result.error) setError(result.error);
          });
        }}
      >
        <RefreshCw />
        Sinkronkan Insight
      </Button>
      {error ? (
        <p role="alert" className="max-w-xs text-right text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
