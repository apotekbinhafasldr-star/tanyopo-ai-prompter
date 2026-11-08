"use client";

import { useState, useTransition } from "react";
import { Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { launchChannelCampaignAction } from "@/features/campaigns/launch-actions";

export function LaunchChannelButton({
  channelCampaignId,
  retry,
  paidLaunchNote,
}: {
  channelCampaignId: string;
  retry?: boolean;
  /**
   * Display only. When set, the button is rendered disabled and this note is
   * shown instead: the paid-launch gate is closed, so there is nothing to
   * trigger. The server-side gate in launch-actions.ts is unchanged and still
   * decides on its own.
   */
  paidLaunchNote?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant={retry ? "outline" : "secondary"}
        loading={pending}
        disabled={Boolean(paidLaunchNote)}
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
      {paidLaunchNote ? <p className="max-w-xs text-right text-xs text-muted-foreground">{paidLaunchNote}</p> : null}
      {error ? (
        <p role="alert" className="max-w-xs text-right text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
