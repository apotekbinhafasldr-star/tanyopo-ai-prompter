"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { scheduleCancellationAction } from "@/features/billing/actions";

/**
 * Batch B10 — "cancel at period end" (Bagian D of the brief). Only shown
 * for a real ACTIVE (paid) subscription. Never sets `status` itself —
 * calls fn_schedule_cancellation() (Owner-only), which only ever toggles
 * `cancel_at_period_end`; access stays ACTIVE until current_period_end.
 */
export function CancellationToggle({
  cancelAtPeriodEnd,
  currentPeriodEndLabel,
  readOnly,
}: {
  cancelAtPeriodEnd: boolean;
  currentPeriodEndLabel: string | null;
  readOnly: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (readOnly) return null;

  return (
    <div className="flex flex-col gap-2">
      {cancelAtPeriodEnd ? (
        <>
          <p className="text-xs text-warning">
            Langganan akan berakhir{currentPeriodEndLabel ? ` pada ${currentPeriodEndLabel}` : " di akhir periode ini"}.
            Akses Anda tetap aktif sampai saat itu.
          </p>
          <Button
            variant="ghost"
            size="sm"
            loading={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await scheduleCancellationAction(false);
                if (result.error) setError(result.error);
              });
            }}
          >
            Batalkan Rencana Berhenti
          </Button>
        </>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          loading={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await scheduleCancellationAction(true);
              if (result.error) setError(result.error);
            });
          }}
        >
          Berhenti Berlangganan di Akhir Periode
        </Button>
      )}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
