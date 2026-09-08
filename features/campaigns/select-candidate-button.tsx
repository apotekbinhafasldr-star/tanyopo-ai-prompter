"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { selectCampaignCandidateAction } from "@/features/campaigns/actions";

export function SelectCandidateButton({
  campaignId,
  candidateIndex,
}: {
  campaignId: string;
  candidateIndex: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11 w-full sm:w-auto"
        loading={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const result = await selectCampaignCandidateAction(campaignId, candidateIndex);
              if (result.error) {
                setError(result.error);
              } else {
                // Direct server action call (not <form action>), so
                // Next.js won't auto-refresh this page's server data —
                // same gotcha already fixed on the campaign submit button.
                router.refresh();
              }
            } catch {
              setError("Gagal menggunakan kandidat ini. Silakan coba lagi.");
            }
          });
        }}
      >
        <Check />
        Gunakan Ini
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
