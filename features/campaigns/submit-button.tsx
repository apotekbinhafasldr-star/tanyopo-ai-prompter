"use client";

import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { submitForApprovalAction } from "@/features/campaigns/actions";

export function SubmitForApprovalButton({ campaignId }: { campaignId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-2">
      <Button
        loading={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await submitForApprovalAction(campaignId);
            if (result.error) setError(result.error);
          });
        }}
      >
        <Send />
        Ajukan untuk Persetujuan
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
