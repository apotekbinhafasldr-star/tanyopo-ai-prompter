"use client";

import { useState, useTransition } from "react";
import { toggleFeatureFlagAction } from "@/features/settings/actions";
import type { FeatureFlagKey } from "@/types/database";

const FLAG_LABELS: Record<FeatureFlagKey, { title: string; description: string }> = {
  global_onboarding: {
    title: "Global onboarding",
    description: "Tandai tenant ini sebagai sudah menggunakan alur onboarding global (informational).",
  },
  multi_currency: {
    title: "Multi-currency",
    description: "Tampilkan opsi mata uang selain IDR di seluruh aplikasi untuk tenant ini.",
  },
  market_targeting: {
    title: "Market targeting",
    description: "Aktifkan target pasar campaign terpisah dari negara bisnis di Promote Wizard.",
  },
  english_ui: {
    title: "English UI",
    description: "Utamakan antarmuka Bahasa Inggris di area yang sudah mendukungnya.",
  },
  regional_capabilities: {
    title: "Regional capabilities",
    description: "Tampilkan rincian kapabilitas connector per wilayah di halaman Connections.",
  },
  global_billing: {
    title: "Global billing",
    description: "Tampilkan metadata billing regional (negara penagihan, mata uang invoice) di Billing.",
  },
  global_analytics_dimensions: {
    title: "Global analytics dimensions",
    description: "Tampilkan dimensi negara/pasar/mata uang tambahan di Analytics.",
  },
};

export function FeatureFlagToggles({
  flags,
  readOnly,
}: {
  flags: Record<FeatureFlagKey, boolean>;
  readOnly: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {(Object.keys(FLAG_LABELS) as FeatureFlagKey[]).map((flagKey) => (
        <FlagToggleRow key={flagKey} flagKey={flagKey} enabled={flags[flagKey]} disabled={readOnly} />
      ))}
    </div>
  );
}

function FlagToggleRow({
  flagKey,
  enabled,
  disabled,
}: {
  flagKey: FeatureFlagKey;
  enabled: boolean;
  disabled: boolean;
}) {
  const [checked, setChecked] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const info = FLAG_LABELS[flagKey];

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
            const result = await toggleFeatureFlagAction(flagKey, next);
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
