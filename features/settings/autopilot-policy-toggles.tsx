"use client";

import { useState, useTransition } from "react";
import { updateAutopilotPolicyAction } from "@/features/settings/actions";
import type { AutopilotPolicyType } from "@/types/database";

interface PolicyRow {
  policy_type: AutopilotPolicyType;
  enabled: boolean;
}

const POLICY_LABELS: Record<AutopilotPolicyType, { title: string; description: string }> = {
  AUTO_PAUSE_UNDERPERFORMING: {
    title: "Ajukan otomatis: jeda channel yang kurang optimal",
    description:
      "Saat Optimization Agent merekomendasikan PAUSE_CHANNEL, langsung ajukan ke Approval Center tanpa menunggu klik manual.",
  },
  AUTO_PROPOSE_BUDGET_REALLOCATION: {
    title: "Ajukan otomatis: realokasi budget antar channel",
    description:
      "Saat Optimization Agent merekomendasikan kenaikan/penurunan budget, langsung ajukan ke Approval Center tanpa menunggu klik manual. Tetap diperiksa Budget Guard sebelum diajukan.",
  },
};

export function AutopilotPolicyToggles({
  policies,
  automationMode,
  readOnly,
}: {
  policies: PolicyRow[];
  automationMode: string;
  readOnly: boolean;
}) {
  const enabledByType = new Map(policies.map((p) => [p.policy_type, p.enabled]));
  const isAutopilotMode = automationMode === "autopilot";

  return (
    <div className="flex flex-col gap-3">
      {!isAutopilotMode ? (
        <p className="text-xs text-muted-foreground">
          Kebijakan di bawah hanya berlaku saat Mode Automation diatur ke <strong>Autopilot</strong>.
        </p>
      ) : null}
      {(Object.keys(POLICY_LABELS) as AutopilotPolicyType[]).map((policyType) => (
        <PolicyToggleRow
          key={policyType}
          policyType={policyType}
          enabled={enabledByType.get(policyType) ?? false}
          disabled={readOnly || !isAutopilotMode}
        />
      ))}
    </div>
  );
}

function PolicyToggleRow({
  policyType,
  enabled,
  disabled,
}: {
  policyType: AutopilotPolicyType;
  enabled: boolean;
  disabled: boolean;
}) {
  const [checked, setChecked] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const info = POLICY_LABELS[policyType];

  return (
    <label className="flex items-start gap-3 rounded-[var(--radius-md)] border border-border p-3">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled || pending}
        onChange={(e) => {
          const next = e.target.checked;
          setChecked(next);
          setError(null);
          startTransition(async () => {
            const result = await updateAutopilotPolicyAction(policyType, next);
            if (result.error) {
              setError(result.error);
              setChecked(!next);
            }
          });
        }}
        className="mt-0.5 size-4"
      />
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium text-foreground">{info.title}</p>
        <p className="text-xs text-muted-foreground">{info.description}</p>
        {error ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </label>
  );
}
