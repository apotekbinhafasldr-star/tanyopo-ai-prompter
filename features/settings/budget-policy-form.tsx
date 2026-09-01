"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateBudgetPolicyAction, type SettingsActionState } from "@/features/settings/actions";
import type { Database } from "@/types/database";

type BudgetPolicy = Database["public"]["Tables"]["prompter_budget_policies"]["Row"] | null;

const initialState: SettingsActionState = { error: null };

export function BudgetPolicyForm({ policy, readOnly }: { policy: BudgetPolicy; readOnly: boolean }) {
  const [state, formAction, pending] = useActionState(updateBudgetPolicyAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dailyLimit">Batas Harian (IDR)</Label>
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
          <Label htmlFor="monthlyLimit">Batas Bulanan (IDR)</Label>
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
        <div className="flex flex-col gap-1.5">
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
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="requireApprovalAbove">Wajib Persetujuan di Atas (IDR)</Label>
          <Input
            id="requireApprovalAbove"
            name="requireApprovalAbove"
            type="number"
            min={0}
            defaultValue={policy?.require_approval_above ?? ""}
            disabled={readOnly}
            placeholder="Belum digunakan"
          />
        </div>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      {readOnly ? (
        <p className="text-xs text-muted-foreground">Hanya Owner yang dapat mengubah Budget Guard.</p>
      ) : (
        <div>
          <Button type="submit" size="sm" loading={pending}>
            Simpan Budget Guard
          </Button>
        </div>
      )}
    </form>
  );
}
