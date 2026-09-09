"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { selectCampaignMediaAction } from "@/features/campaigns/actions";

/** Batch B4 — mirrors SelectCandidateButton's direct-server-action-call
 * pattern (not a <form>) for the same reason: router.refresh() after a
 * successful pick, since Next won't auto-refresh server data for a call
 * outside <form action>. */
export function SelectMediaButton({ campaignId, mediaId }: { campaignId: string; mediaId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11 w-full"
        loading={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const result = await selectCampaignMediaAction(campaignId, mediaId);
              if (result.error) {
                setError(result.error);
              } else {
                router.refresh();
              }
            } catch {
              setError("Gagal menggunakan media ini. Silakan coba lagi.");
            }
          });
        }}
      >
        <Check className="size-3.5" aria-hidden />
        Gunakan
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
