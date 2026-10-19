"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  addManualMetricAction,
  type ManualMetricsActionState,
} from "@/features/campaigns/manual-metrics-actions";

const initialState: ManualMetricsActionState = { error: null, success: null };

/**
 * Daily manual metric entry for ONE channel campaign. Numbers are plain text
 * inputs (not type="number") so the server's strict parser — which refuses
 * "150.000"-style separators instead of misreading them — sees exactly what the
 * person typed. The currency is not a field: the server takes it from the
 * campaign.
 */
export function ManualMetricsForm({
  channelCampaignId,
  currency,
  todayIso,
}: {
  channelCampaignId: string;
  currency: string;
  todayIso: string;
}) {
  const [state, formAction, pending] = useActionState(addManualMetricAction, initialState);
  const idPrefix = `mm-${channelCampaignId}`;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="channelCampaignId" value={channelCampaignId} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor={`${idPrefix}-date`}>Tanggal</Label>
          <Input id={`${idPrefix}-date`} name="metricDate" type="date" max={todayIso} defaultValue={todayIso} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-spend`}>Biaya iklan ({currency})</Label>
          <Input id={`${idPrefix}-spend`} name="spend" inputMode="decimal" autoComplete="off" placeholder="150000" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-revenue`}>Omzet dari iklan ({currency})</Label>
          <Input id={`${idPrefix}-revenue`} name="revenue" inputMode="decimal" autoComplete="off" placeholder="0" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-impressions`}>Tayangan</Label>
          <Input id={`${idPrefix}-impressions`} name="impressions" inputMode="numeric" autoComplete="off" placeholder="12500" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-clicks`}>Klik</Label>
          <Input id={`${idPrefix}-clicks`} name="clicks" inputMode="numeric" autoComplete="off" placeholder="240" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-conversions`}>Konversi (pembelian)</Label>
          <Input id={`${idPrefix}-conversions`} name="conversions" inputMode="numeric" autoComplete="off" placeholder="12" required />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Tulis angka biasa tanpa titik/koma pemisah ribuan. Satu entri per tanggal.
      </p>

      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p role="status" className="text-sm text-success">
          {state.success}
        </p>
      ) : null}

      <div>
        <Button type="submit" size="sm" loading={pending} className="w-full sm:w-auto">
          Simpan Data Harian
        </Button>
      </div>
    </form>
  );
}
