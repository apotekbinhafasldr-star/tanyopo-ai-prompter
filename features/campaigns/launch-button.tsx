"use client";

import { useState, useTransition } from "react";
import { Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { launchChannelCampaignAction } from "@/features/campaigns/launch-actions";

export function LaunchChannelButton({
  channelCampaignId,
  retry,
}: {
  channelCampaignId: string;
  retry?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant={retry ? "outline" : "secondary"}
        loading={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await launchChannelCampaignAction(channelCampaignId);
            if (result.error) setError(result.error);
          });
        }}
      >
        <Rocket />
        {retry ? "Coba Lagi" : "Luncurkan"}
      </Button>
      {error ? (
        <p role="alert" className="max-w-xs text-right text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
