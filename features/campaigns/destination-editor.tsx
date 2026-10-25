"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { PurchaseDestinationField } from "@/features/promote/purchase-destination-field";
import {
  updateCampaignDestinationAction,
  type DestinationEditState,
} from "@/features/campaigns/actions";
import type { DestinationType } from "@/lib/campaigns/purchase-destination";

const INITIAL: DestinationEditState = { error: null, saved: false };

/**
 * Draft-only editor for a campaign's purchase destination. The server action re-validates everything,
 * checks the role, the tenant and the DRAFT status; this form is only a convenience.
 */
export function DestinationEditor({
  campaignId,
  initialType,
  initialValue,
}: {
  campaignId: string;
  initialType: DestinationType | "";
  initialValue: string;
}) {
  const [open, setOpen] = useState(false);
  const [valid, setValid] = useState(false);
  const [state, formAction, pending] = useActionState(
    updateCampaignDestinationAction.bind(null, campaignId),
    INITIAL,
  );

  if (!open) {
    return (
      <div className="flex flex-col gap-1.5">
        {state.saved ? (
          <p role="status" className="text-xs text-foreground">
            Tujuan iklan disimpan.
          </p>
        ) : null}
        <Button type="button" variant="outline" size="sm" className="min-h-11 self-start" onClick={() => setOpen(true)}>
          Ubah tujuan
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3 border-t border-border pt-3">
      <PurchaseDestinationField
        initialType={initialType}
        initialValue={initialValue}
        onValidityChange={setValid}
      />
      <p className="text-xs text-muted-foreground">
        Perubahan hanya berlaku untuk campaign ini dan hanya saat Draft. Data produk dan brand tidak berubah.
      </p>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" className="min-h-11" disabled={!valid || pending}>
          {pending ? "Menyimpan..." : "Simpan tujuan"}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={() => setOpen(false)}>
          Tutup
        </Button>
      </div>
    </form>
  );
}
