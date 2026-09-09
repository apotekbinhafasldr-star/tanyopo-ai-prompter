"use client";

import { useActionState, useState } from "react";
import { CalendarDays, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { scheduleContentAction, type ContentActionState } from "@/features/content/actions";

const initialState: ContentActionState = { error: null };

export interface ScheduleRecommendation {
  /** Already formatted for a datetime-local input's value, in the tenant's own timezone. */
  localInputValue: string;
  /** Human-readable "Rabu, 9 Sep • 19.30 WIB" style label. */
  label: string;
  reason: string;
}

/**
 * Batch B3 — Smart Scheduling. Shows LINOE's recommended publish time
 * (computed server-side, tenant-timezone-aware) with a one-tap "Gunakan
 * Rekomendasi LINOE", and keeps manual date+time entry available behind
 * "Ubah Jadwal" — both inline in this same card, no separate menu/page.
 * `recommendation` is null for a platform with no meaningful "best time"
 * concept (e.g. WEBSITE content); the manual option still works then.
 */
export function ScheduleForm({
  contentItemId,
  scheduledAt,
  scheduledLabel,
  recommendation,
}: {
  contentItemId: string;
  scheduledAt: string | null;
  scheduledLabel: string | null;
  recommendation: ScheduleRecommendation | null;
}) {
  const boundAction = scheduleContentAction.bind(null, contentItemId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const [manualOpen, setManualOpen] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      {scheduledAt && scheduledLabel ? (
        <p className="flex items-center gap-1.5 text-xs text-foreground">
          <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          Terjadwal: <span className="font-medium">{scheduledLabel}</span>
        </p>
      ) : null}

      {recommendation ? (
        <div className="rounded-[var(--radius-md)] bg-brand-muted p-2.5">
          <p className="text-xs font-medium text-brand">Rekomendasi LINOE: {recommendation.label}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{recommendation.reason}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Rekomendasi awal berdasarkan pola umum platform ini — akan semakin akurat setelah LINOE
            memiliki data performa akun Anda.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {recommendation ? (
          <form action={formAction}>
            <input type="hidden" name="scheduledAt" value={recommendation.localInputValue} />
            <Button type="submit" size="sm" variant="outline" className="min-h-11" loading={pending}>
              <Sparkles className="size-3.5" aria-hidden />
              Gunakan Rekomendasi LINOE
            </Button>
          </form>
        ) : null}

        {!manualOpen ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="min-h-11"
            onClick={() => setManualOpen(true)}
          >
            Ubah Jadwal
          </Button>
        ) : (
          <form action={formAction} className="flex flex-wrap items-center gap-2">
            <Input
              type="datetime-local"
              name="scheduledAt"
              defaultValue={recommendation?.localInputValue ?? ""}
              className="h-11 w-auto text-xs"
            />
            <Button type="submit" size="sm" variant="ghost" className="min-h-11" loading={pending}>
              {scheduledAt ? "Simpan" : "Jadwalkan"}
            </Button>
          </form>
        )}
      </div>

      {state.error ? (
        <span role="alert" className="text-xs text-danger">
          {state.error}
        </span>
      ) : null}
    </div>
  );
}
