"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { submitForApprovalAction } from "@/features/campaigns/actions";

export function SubmitForApprovalButton({ campaignId }: { campaignId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="flex flex-col gap-2">
      <Button
        loading={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              // Called directly (not via a <form action>), so Next.js never
              // auto-refreshes this page's server-rendered content after a
              // successful call — without this, the campaign actually moves
              // to AWAITING_APPROVAL in the database (confirmed: the write
              // succeeds) but the Draft banner/status badge on screen never
              // updates, looking exactly like the request never finished.
              const result = await submitForApprovalAction(campaignId);
              if (result.error) {
                setError(result.error);
              } else {
                router.refresh();
              }
            } catch {
              // A direct server action call has no built-in retry/error UI
              // the way a <form action> does — without this catch, any
              // rejection (a dropped connection, a session hiccup mid-call)
              // left the button spinning forever with no way to recover,
              // since useTransition only clears `pending` once this async
              // callback actually settles.
              setError("Gagal mengajukan campaign untuk persetujuan. Silakan coba lagi.");
            }
          });
        }}
      >
        <Send />
        Setujui &amp; Siapkan Campaign
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
