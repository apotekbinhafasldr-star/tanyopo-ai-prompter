"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toggleEmergencyStopAction } from "@/features/settings/actions";

/**
 * Batch B9 — same toggleEmergencyStopAction/prompter_automation_settings
 * logic as before. The one behavior change (explicitly requested, purely
 * UI-side): activating Emergency Stop now requires a second confirming
 * tap before the action actually fires, since the prior version fired
 * immediately on the first click. Deactivating is unchanged (single
 * click) — that's the "return to normal" direction, not the risky one.
 */
export function EmergencyStopButton({
  active,
  activatedAt,
  reason,
}: {
  active: boolean;
  activatedAt: string | null;
  reason: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [stopReason, setStopReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggle(next: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await toggleEmergencyStopAction(next, next ? stopReason || null : null);
      if (result.error) setError(result.error);
      setConfirming(false);
    });
  }

  if (active) {
    return (
      <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-danger bg-danger-muted p-4">
        <div className="flex items-center gap-2 text-danger">
          <AlertTriangle className="size-4" aria-hidden />
          <p className="text-sm font-semibold">Semua Otomatisasi Sedang Dihentikan</p>
        </div>
        <p className="text-xs text-danger">
          Semua eksekusi tindakan otomatis LINOE dihentikan, apa pun cara LINOE membantu atau kebijakan yang
          aktif.
          {reason ? ` Alasan: ${reason}.` : ""}
          {activatedAt ? ` Diaktifkan ${new Date(activatedAt).toLocaleString("id-ID")}.` : ""}
        </p>
        <div>
          <Button size="sm" variant="secondary" loading={pending} onClick={() => toggle(false)}>
            Aktifkan Kembali Otomatisasi
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-danger/40 bg-danger-muted/60 p-4">
        <div className="flex items-center gap-2 text-danger">
          <AlertTriangle className="size-4" aria-hidden />
          <p className="text-sm font-semibold">Yakin ingin menghentikan semua otomatisasi?</p>
        </div>
        <p className="text-xs text-foreground">
          LINOE akan langsung berhenti menjalankan tindakan otomatis apa pun sampai Anda mengaktifkannya kembali.
        </p>
        <Input
          value={stopReason}
          onChange={(e) => setStopReason(e.target.value)}
          placeholder="Alasan (opsional)"
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="destructive" loading={pending} onClick={() => toggle(true)}>
            <ShieldOff />
            Ya, Hentikan Sekarang
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
            Batal
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button size="sm" variant="destructive" onClick={() => setConfirming(true)}>
          <ShieldOff />
          Hentikan Semua Otomatisasi
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Menghentikan seketika semua eksekusi tindakan otomatis LINOE untuk bisnis ini — berlaku terlepas dari
        cara LINOE membantu atau kebijakan yang sedang aktif.
      </p>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
