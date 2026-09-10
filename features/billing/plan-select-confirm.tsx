"use client";

import { useActionState, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { formatCurrency } from "@/lib/utils/format";
import { changePlanAction, type BillingActionState } from "@/features/billing/actions";
import type { SubscriptionPlan } from "@/types/database";

const initialState: BillingActionState = { error: null };

/**
 * Batch B8 final hotfix — "Lihat Detail" -> "Pilih Paket Ini" -> explicit
 * confirmation -> "Simpan Pilihan Paket". Reuses changePlanAction/
 * changePlan() exactly as B7 built it: that action only ever writes the
 * `plan` column, never `status` — so confirming here can never activate a
 * paid entitlement, regardless of which plan is picked. No payment, no
 * checkout, no new persistence mechanism. Once saved, the server page
 * re-renders with the new subscription.plan and this card either becomes
 * the "Paket Anda Saat Ini" card (unmounting this component) or, on
 * failure, stays in the confirmation step so the error is visible and the
 * user can retry.
 *
 * Batch B8 CTA-clarity hotfix — this is now rendered directly on the card
 * (below "Lihat Detail", not inside it) as the card's one high-contrast
 * primary CTA. `primaryCtaClassName` is a solid, saturated color per plan
 * (not the lighter `actionBar` tint used for "Lihat Detail"), so the
 * button reads unmistakably as the primary action against every card
 * background, including Growth's gradient.
 */
export function PlanSelectConfirm({
  planId,
  planName,
  priceIDR,
  pricePeriodLabel,
  primaryCtaClassName,
  mutedTextClassName,
  dividerClassName,
  readOnly,
}: {
  planId: SubscriptionPlan;
  planName: string;
  priceIDR: number;
  pricePeriodLabel: string;
  primaryCtaClassName: string;
  mutedTextClassName: string;
  dividerClassName: string;
  readOnly: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(changePlanAction, initialState);

  if (readOnly) {
    return <p className={cn("text-xs", mutedTextClassName)}>Hanya Owner yang dapat memilih paket.</p>;
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className={cn(
          "flex min-h-11 w-full cursor-pointer items-center justify-center rounded-full px-4 py-2.5 text-center text-sm font-semibold shadow-sm",
          primaryCtaClassName,
        )}
      >
        Pilih Paket Ini
      </button>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2 rounded-[var(--radius-md)] border-t bg-black/5 p-3", dividerClassName)}>
      <p className={cn("text-sm font-semibold", mutedTextClassName)}>Anda memilih Paket {planName}</p>
      <p className={cn("flex flex-wrap items-baseline gap-x-1 text-sm font-semibold", mutedTextClassName)}>
        <span>{formatCurrency(priceIDR)}</span>
        <span>{pricePeriodLabel}</span>
      </p>
      <p className={cn("text-xs", mutedTextClassName)}>
        Pembayaran online sedang dipersiapkan. Paket aktif Anda belum berubah sampai pembayaran tersedia dan
        berhasil diverifikasi.
      </p>
      <form action={formAction} className="flex flex-col gap-2">
        <input type="hidden" name="plan" value={planId} />
        {state.error ? (
          <p role="alert" className="text-xs font-medium text-danger">
            {state.error}
          </p>
        ) : null}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className={cn(
              "flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-full px-4 py-2.5 text-center text-sm font-semibold shadow-sm disabled:opacity-60",
              primaryCtaClassName,
            )}
          >
            {pending ? "Menyimpan..." : "Simpan Pilihan Paket"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className={cn("min-h-11 px-2 text-xs font-medium underline-offset-2 hover:underline", mutedTextClassName)}
          >
            Kembali
          </button>
        </div>
      </form>
    </div>
  );
}
