"use client";

import { createContext, useContext, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { submitForApprovalAction } from "@/features/campaigns/actions";

interface SubmitFlowState {
  pending: boolean;
  error: string | null;
  submit: () => void;
}

const SubmitFlowContext = createContext<SubmitFlowState | null>(null);

/**
 * Shares one submission-in-flight between the top-of-page and
 * end-of-review "Setujui & Siapkan Campaign" CTAs (Batch A correction
 * #3 added a second CTA at the bottom of the review). Both buttons read
 * the same pending/error state, and the inFlight ref — not React state,
 * which only updates after a render — is what actually stops a
 * near-simultaneous click on the other button from firing a second
 * submitForApprovalAction call while one is already in flight.
 */
export function CampaignSubmitProvider({ campaignId, children }: { campaignId: string; children: ReactNode }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const inFlight = useRef(false);

  function submit() {
    if (inFlight.current) return;
    inFlight.current = true;
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
      } finally {
        inFlight.current = false;
      }
    });
  }

  return <SubmitFlowContext.Provider value={{ pending, error, submit }}>{children}</SubmitFlowContext.Provider>;
}

function useSubmitFlow(): SubmitFlowState {
  const ctx = useContext(SubmitFlowContext);
  if (!ctx) {
    throw new Error("SubmitForApprovalButton must be rendered inside a CampaignSubmitProvider");
  }
  return ctx;
}

export function SubmitForApprovalButton({ fullWidth = false }: { fullWidth?: boolean } = {}) {
  const { pending, error, submit } = useSubmitFlow();

  return (
    <div className={cn("flex flex-col gap-2", fullWidth && "w-full sm:w-auto")}>
      <Button loading={pending} className={cn(fullWidth && "w-full")} onClick={submit}>
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
