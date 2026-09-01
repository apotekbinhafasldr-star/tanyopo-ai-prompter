"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { growthPlatforms } from "@/schemas/growth";
import { setGrowthGoalAction, type GrowthActionState } from "@/features/growth/actions";

const initialState: GrowthActionState = { error: null };

const selectClass =
  "h-10 rounded-[var(--radius-md)] border border-border-strong bg-surface px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40";

export function GrowthGoalForm() {
  const [state, formAction, pending] = useActionState(setGrowthGoalAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="goal-platform">Platform</Label>
          <select id="goal-platform" name="platform" defaultValue="" required className={selectClass}>
            <option value="" disabled>
              Pilih platform
            </option>
            {growthPlatforms.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="targetFollowers">Target Followers</Label>
          <Input id="targetFollowers" name="targetFollowers" type="number" min={0} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="targetDate">Target Tanggal (opsional)</Label>
          <Input id="targetDate" name="targetDate" type="date" />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="notes">Catatan (opsional)</Label>
          <Textarea id="notes" name="notes" rows={2} placeholder="Strategi organik yang direncanakan, misalnya konten mingguan atau kolaborasi." />
        </div>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <div>
        <Button type="submit" size="sm" loading={pending}>
          Simpan Target
        </Button>
      </div>
    </form>
  );
}
