"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { updateComplianceFlagAction, type SettingsActionState } from "@/features/settings/actions";
import { COMPLIANCE_FLAG_TYPES } from "@/schemas/compliance";
import type { ComplianceFlagType, ComplianceStatus, Database } from "@/types/database";

type ComplianceFlag = Database["public"]["Tables"]["prompter_compliance_flags"]["Row"];

const initialState: SettingsActionState = { error: null };

const FLAG_LABELS: Record<ComplianceFlagType, string> = {
  DATA_RESIDENCY: "Data Residency",
  MARKETING_CONSENT: "Marketing Consent",
  AGE_SENSITIVE_PRODUCT: "Produk Sensitif Usia",
  REGULATED_PRODUCT: "Produk Teregulasi",
  PLATFORM_AD_RESTRICTION: "Batasan Iklan Platform",
  TERMS_PRIVACY_LINK: "Tautan Terms & Privacy",
};

const STATUS_LABELS: Record<ComplianceStatus, string> = {
  COMPLIANCE_REVIEW_REQUIRED: "Perlu Ditinjau",
  SUPPORTED: "Didukung",
  RESTRICTED: "Dibatasi",
  NOT_CONFIGURED: "Belum Dikonfigurasi",
};

const selectClass =
  "h-9 rounded-[var(--radius-md)] border border-border-strong bg-surface px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40";

export function ComplianceFlagsForm({
  flags,
  readOnly,
}: {
  flags: ComplianceFlag[];
  readOnly: boolean;
}) {
  const flagByType = new Map(flags.map((f) => [f.flag_type, f]));

  return (
    <div className="flex flex-col divide-y divide-border">
      {COMPLIANCE_FLAG_TYPES.map((flagType) => (
        <ComplianceFlagRow key={flagType} flagType={flagType} flag={flagByType.get(flagType)} readOnly={readOnly} />
      ))}
    </div>
  );
}

function ComplianceFlagRow({
  flagType,
  flag,
  readOnly,
}: {
  flagType: ComplianceFlagType;
  flag: ComplianceFlag | undefined;
  readOnly: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateComplianceFlagAction, initialState);
  const status = flag?.status ?? "NOT_CONFIGURED";

  if (readOnly) {
    return (
      <div className="flex items-center justify-between gap-3 py-3">
        <p className="text-sm text-foreground">{FLAG_LABELS[flagType]}</p>
        <span className="text-xs text-muted-foreground">{STATUS_LABELS[status]}</span>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2 py-3">
      <input type="hidden" name="flagType" value={flagType} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="text-sm text-foreground">{FLAG_LABELS[flagType]}</Label>
        <div className="flex items-center gap-2">
          <select name="status" defaultValue={status} className={selectClass}>
            {(Object.keys(STATUS_LABELS) as ComplianceStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" variant="secondary" loading={pending}>
            Simpan
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input name="notes" defaultValue={flag?.notes ?? ""} placeholder="Catatan (opsional)" />
        {flagType === "TERMS_PRIVACY_LINK" ? (
          <Input name="url" type="url" defaultValue={flag?.url ?? ""} placeholder="https://" />
        ) : null}
      </div>
      {state.error ? (
        <p role="alert" className="text-xs text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
