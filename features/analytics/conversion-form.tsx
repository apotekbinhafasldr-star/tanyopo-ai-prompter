"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { conversionEventTypes } from "@/schemas/conversion";
import { logConversionAction, type AnalyticsActionState } from "@/features/analytics/actions";

interface CampaignOption {
  id: string;
  name: string;
}

const initialState: AnalyticsActionState = { error: null };

const selectClass =
  "h-10 rounded-[var(--radius-md)] border border-border-strong bg-surface px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40";

export function ConversionForm({ campaigns }: { campaigns: CampaignOption[] }) {
  const [state, formAction, pending] = useActionState(logConversionAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="eventType">Jenis Konversi</Label>
          <select id="eventType" name="eventType" defaultValue="" required className={selectClass}>
            <option value="" disabled>
              Pilih jenis
            </option>
            {conversionEventTypes.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="campaignId">Campaign (opsional)</Label>
          <select id="campaignId" name="campaignId" defaultValue="" className={selectClass}>
            <option value="">Tidak terkait campaign</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="value">Nilai (IDR, opsional)</Label>
          <Input id="value" name="value" type="number" min={0} step="0.01" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="customerReference">Referensi Pelanggan (opsional)</Label>
          <Input id="customerReference" name="customerReference" placeholder="Nama atau nomor WhatsApp" />
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="occurredAt">Tanggal Kejadian</Label>
          <Input id="occurredAt" name="occurredAt" type="datetime-local" />
        </div>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <div>
        <Button type="submit" size="sm" loading={pending}>
          Catat Konversi
        </Button>
      </div>
    </form>
  );
}
