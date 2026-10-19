"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteManualMetricAction,
  updateManualMetricAction,
  type ManualMetricsActionState,
} from "@/features/campaigns/manual-metrics-actions";

const initialState: ManualMetricsActionState = { error: null, success: null };

interface RowValues {
  id: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
}

/** Edit (metrics only — date/channel/currency are immutable) and delete for one stored entry. */
export function ManualMetricRowActions({
  row,
  canEdit,
  editable,
}: {
  row: RowValues;
  /** Owner/marketing may change data at all. */
  canEdit: boolean;
  /** The channel is still manual-only (no platform link), so metrics may be edited; delete is always allowed to a writer. */
  editable: boolean;
}) {
  const [editState, editAction, editPending] = useActionState(updateManualMetricAction, initialState);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteManualMetricAction, initialState);
  const prefix = `mm-edit-${row.id}`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {canEdit && editable ? (
          <details className="group w-full">
            <summary className="inline-flex h-9 cursor-pointer items-center rounded-[var(--radius-md)] px-3 text-sm font-medium text-brand hover:bg-brand-muted">
              Edit
            </summary>
            <form action={editAction} className="mt-3 flex flex-col gap-3">
              <input type="hidden" name="id" value={row.id} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${prefix}-spend`}>Biaya iklan</Label>
                  <Input id={`${prefix}-spend`} name="spend" inputMode="decimal" defaultValue={String(row.spend)} required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${prefix}-revenue`}>Omzet dari iklan</Label>
                  <Input id={`${prefix}-revenue`} name="revenue" inputMode="decimal" defaultValue={String(row.revenue)} required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${prefix}-impressions`}>Tayangan</Label>
                  <Input id={`${prefix}-impressions`} name="impressions" inputMode="numeric" defaultValue={String(row.impressions)} required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${prefix}-clicks`}>Klik</Label>
                  <Input id={`${prefix}-clicks`} name="clicks" inputMode="numeric" defaultValue={String(row.clicks)} required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${prefix}-conversions`}>Konversi</Label>
                  <Input id={`${prefix}-conversions`} name="conversions" inputMode="numeric" defaultValue={String(row.conversions)} required />
                </div>
              </div>
              {editState.error ? (
                <p role="alert" className="text-sm text-danger">
                  {editState.error}
                </p>
              ) : null}
              {editState.success ? (
                <p role="status" className="text-sm text-success">
                  {editState.success}
                </p>
              ) : null}
              <div>
                <Button type="submit" size="sm" loading={editPending} className="w-full sm:w-auto">
                  Simpan Perubahan
                </Button>
              </div>
            </form>
          </details>
        ) : null}

        {canEdit ? (
          <form
            action={deleteAction}
            onSubmit={(event) => {
              if (!window.confirm("Hapus entri metrik ini? Tindakan ini tidak dapat dibatalkan.")) {
                event.preventDefault();
              }
            }}
          >
            <input type="hidden" name="id" value={row.id} />
            <Button type="submit" variant="ghost" size="sm" loading={deletePending}>
              Hapus
            </Button>
          </form>
        ) : null}
      </div>
      {deleteState.error ? (
        <p role="alert" className="text-sm text-danger">
          {deleteState.error}
        </p>
      ) : null}
    </div>
  );
}
