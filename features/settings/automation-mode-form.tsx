"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { updateAutomationModeAction, type SettingsActionState } from "@/features/settings/actions";
import type { AutomationMode } from "@/types/database";

const initialState: SettingsActionState = { error: null };

const MODE_OPTIONS: { value: AutomationMode; label: string; description: string }[] = [
  { value: "manual", label: "Manual", description: "Semua tindakan (launch, budget, pause) memerlukan aksi Anda secara langsung." },
  { value: "ai_assist", label: "AI Assist", description: "AI membuat rekomendasi (Analytics/Optimization Agent) — Anda memilih kapan mengajukannya ke Approval Center." },
  { value: "autopilot", label: "Autopilot", description: "Rekomendasi yang cocok dengan kebijakan autopilot yang aktif diajukan otomatis ke Approval Center — tetap memerlukan persetujuan Owner sebelum tereksekusi ke platform." },
];

const selectClass =
  "h-10 rounded-[var(--radius-md)] border border-border-strong bg-surface px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40";

export function AutomationModeForm({ currentMode, readOnly }: { currentMode: AutomationMode; readOnly: boolean }) {
  const [state, formAction, pending] = useActionState(updateAutomationModeAction, initialState);

  if (readOnly) {
    return (
      <p className="text-xs text-muted-foreground">
        Mode saat ini: <strong>{MODE_OPTIONS.find((m) => m.value === currentMode)?.label ?? currentMode}</strong>.
        Hanya Owner yang dapat mengubah mode automation.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="automationMode">Mode Automation</Label>
        <select id="automationMode" name="automationMode" defaultValue={currentMode} className={selectClass}>
          {MODE_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        {MODE_OPTIONS.map((m) =>
          m.value === currentMode ? (
            <p key={m.value} className="text-xs text-muted-foreground">
              {m.description}
            </p>
          ) : null,
        )}
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <div>
        <Button type="submit" size="sm" loading={pending}>
          Simpan Mode
        </Button>
      </div>
    </form>
  );
}
