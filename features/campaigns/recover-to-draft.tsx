"use client";

import { useActionState, useState } from "react";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { recoverBlockedScheduledCampaignAction, type RecoverState } from "@/features/campaigns/actions";

const INITIAL: RecoverState = { error: null, done: false };

/**
 * For a Scheduled campaign that cannot launch because its destination no longer matches what was approved
 * (or the approval predates destination records). Two taps: the server re-checks everything and refuses
 * a campaign that is not blocked, already launched, or has ad activity.
 */
export function RecoverToDraft({ campaignId }: { campaignId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(
    recoverBlockedScheduledCampaignAction.bind(null, campaignId),
    INITIAL,
  );

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4 text-sm">
        <p className="font-semibold text-foreground">Tujuan iklan atau persetujuan bermasalah?</p>
        <p className="text-xs text-muted-foreground">
          Jika peluncuran ditolak karena tujuan iklan berbeda dari yang disetujui (atau persetujuan lama tidak
          mencatat tujuan), kembalikan campaign ke Draft, perbaiki tujuannya, lalu ajukan dan setujui ulang.
          Hanya Owner, dan hanya untuk campaign yang belum pernah diluncurkan dan belum punya data pengeluaran
          iklan. Persetujuan lama menjadi tidak berlaku.
        </p>
        {state.error ? (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        ) : null}
        {!confirming ? (
          <Button type="button" variant="outline" size="sm" className="min-h-11 self-start" onClick={() => setConfirming(true)}>
            <Undo2 />
            Kembalikan ke Draft
          </Button>
        ) : (
          <form action={formAction} className="flex flex-col gap-2">
            <p className="text-xs text-foreground">Yakin? Persetujuan yang ada akan dibatalkan.</p>
            <div className="flex gap-2">
              <Button type="submit" size="sm" className="min-h-11" loading={pending}>
                Ya, kembalikan
              </Button>
              <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={() => setConfirming(false)}>
                Batal
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
