"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateBudgetPolicyAction, type SettingsActionState } from "@/features/settings/actions";
import type { Database } from "@/types/database";

type BudgetPolicy = Database["public"]["Tables"]["prompter_budget_policies"]["Row"] | null;

const initialState: SettingsActionState = { error: null };

/**
 * Batch B9 — presentation-only relabel of the existing Budget Guard form.
 * Same fields, same schema (schemas/budget.ts), same
 * updateBudgetPolicyAction/enforcement (lib/budget-guard.ts) as before —
 * only the labels/copy and the addition of a second, clearly-labeled
 * "Persetujuan Pengeluaran" group change. Both groups stay one <form> so
 * saving is still a single action/single audit-log entry, matching how
 * both values already live in the same prompter_budget_policies row.
 */
export function BudgetPolicyForm({ policy, readOnly }: { policy: BudgetPolicy; readOnly: boolean }) {
  const [state, formAction, pending] = useActionState(updateBudgetPolicyAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">
          Atur batas agar biaya promosi tetap sesuai anggaran bisnis Anda. Kosongkan jika Anda tidak ingin
          membatasi jumlahnya.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="dailyLimit">Batas per Hari (IDR)</Label>
            <Input
              id="dailyLimit"
              name="dailyLimit"
              type="number"
              min={0}
              defaultValue={policy?.daily_limit ?? ""}
              disabled={readOnly}
              placeholder="Tanpa batas"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="monthlyLimit">Batas per Bulan (IDR)</Label>
            <Input
              id="monthlyLimit"
              name="monthlyLimit"
              type="number"
              min={0}
              defaultValue={policy?.monthly_limit ?? ""}
              disabled={readOnly}
              placeholder="Tanpa batas"
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="campaignLimit">Batas per Campaign (IDR)</Label>
            <Input
              id="campaignLimit"
              name="campaignLimit"
              type="number"
              min={0}
              defaultValue={policy?.campaign_limit ?? ""}
              disabled={readOnly}
              placeholder="Tanpa batas"
            />
            <p className="text-xs text-muted-foreground">
              Campaign dengan budget di atas ini akan ditolak otomatis saat diajukan.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <div>
          <p className="text-sm font-medium text-foreground">Minta Persetujuan Sebelum Mengeluarkan Uang</p>
          <p className="text-xs text-muted-foreground">
            LINOE akan meminta persetujuan Anda sebelum campaign melewati batas yang Anda tentukan di bawah ini.
          </p>
        </div>
        <div className="flex flex-col gap-1.5 sm:max-w-xs">
          <Label htmlFor="requireApprovalAbove">Minta Persetujuan Jika Biaya Melebihi (IDR)</Label>
          <Input
            id="requireApprovalAbove"
            name="requireApprovalAbove"
            type="number"
            min={0}
            defaultValue={policy?.require_approval_above ?? ""}
            disabled={readOnly}
            placeholder="Belum diatur"
          />
        </div>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      {readOnly ? (
        <p className="text-xs text-muted-foreground">Hanya Owner yang dapat mengubah pengaturan ini.</p>
      ) : (
        <div>
          <Button type="submit" size="sm" loading={pending}>
            Simpan Pengaturan
          </Button>
        </div>
      )}
    </form>
  );
}
