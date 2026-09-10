"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { updateAutomationModeAction, type SettingsActionState } from "@/features/settings/actions";
import type { AutomationMode } from "@/types/database";

const initialState: SettingsActionState = { error: null };

/**
 * Batch B9 — plain-language relabel only. The underlying value submitted
 * is still exactly "manual" | "ai_assist" | "autopilot"
 * (updateAutomationModeAction/prompter_automation_settings.automation_mode
 * are untouched) — only the display label/description changes, and the
 * dropdown becomes a set of selectable cards for a friendlier, less
 * "technical dashboard" feel. The "autopilot" label stays honest about
 * the fact execution still requires Owner approval — nothing here claims
 * fully unattended automation.
 */
const MODE_OPTIONS: { value: AutomationMode; label: string; description: string }[] = [
  {
    value: "manual",
    label: "Saya Setujui Sendiri",
    description: "Semua tindakan (menjalankan campaign, mengatur budget, menjeda) memerlukan aksi Anda secara langsung.",
  },
  {
    value: "ai_assist",
    label: "LINOE Membantu, Saya Tetap Mengontrol",
    description: "LINOE membuat rekomendasi — Anda yang memilih kapan mengajukannya ke Approval Center.",
  },
  {
    value: "autopilot",
    label: "Otomatis, Tetap Anda yang Menyetujui",
    description:
      "LINOE mengajukan rekomendasi yang sesuai kebijakan Anda secara otomatis ke Approval Center — tetap memerlukan persetujuan Owner sebelum benar-benar dijalankan.",
  },
];

export function AutomationModeForm({ currentMode, readOnly }: { currentMode: AutomationMode; readOnly: boolean }) {
  const [state, formAction, pending] = useActionState(updateAutomationModeAction, initialState);

  if (readOnly) {
    return (
      <p className="text-xs text-muted-foreground">
        Cara LINOE membantu saat ini: <strong>{MODE_OPTIONS.find((m) => m.value === currentMode)?.label ?? currentMode}</strong>.
        Hanya Owner yang dapat mengubah pengaturan ini.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2" role="radiogroup" aria-label="Cara LINOE membantu">
        {MODE_OPTIONS.map((m) => (
          <label
            key={m.value}
            className="flex items-start gap-3 rounded-[var(--radius-md)] border border-border p-3 has-checked:border-brand has-checked:bg-brand-muted"
          >
            <input
              type="radio"
              name="automationMode"
              value={m.value}
              defaultChecked={m.value === currentMode}
              disabled={pending}
              className="mt-0.5 size-4 shrink-0"
            />
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-medium text-foreground">{m.label}</p>
              <p className="text-xs text-muted-foreground">{m.description}</p>
            </div>
          </label>
        ))}
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <div>
        <Button type="submit" size="sm" loading={pending}>
          Simpan
        </Button>
      </div>
    </form>
  );
}
