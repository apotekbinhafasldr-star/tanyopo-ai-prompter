"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { changePlanAction, type BillingActionState } from "@/features/billing/actions";
import type { SubscriptionPlan } from "@/types/database";

const initialState: BillingActionState = { error: null };

const PLAN_OPTIONS: { value: SubscriptionPlan; label: string }[] = [
  { value: "FREE", label: "Free" },
  { value: "PRO", label: "Pro" },
  { value: "BUSINESS", label: "Business" },
  { value: "GROWTH", label: "Growth" },
  { value: "AGENCY", label: "Agency" },
  { value: "UMKMPRO_BUNDLE", label: "UMKMpro Bundle" },
];

const selectClass =
  "h-10 rounded-[var(--radius-md)] border border-border-strong bg-surface px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40";

export function PlanForm({ currentPlan, readOnly }: { currentPlan: SubscriptionPlan; readOnly: boolean }) {
  const [state, formAction, pending] = useActionState(changePlanAction, initialState);

  if (readOnly) {
    return (
      <p className="text-xs text-muted-foreground">
        Hanya Owner yang dapat mengubah paket.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="plan">Ubah Paket</Label>
        <select id="plan" name="plan" defaultValue={currentPlan} className={selectClass}>
          {PLAN_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Belum ada pemroses pembayaran yang terhubung, jadi perubahan ini hanya mengubah paket yang tercatat —
          tidak ada tagihan atau proration yang diproses.
        </p>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <div>
        <Button type="submit" size="sm" loading={pending}>
          Simpan Paket
        </Button>
      </div>
    </form>
  );
}
