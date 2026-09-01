"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toggleEmergencyStopAction } from "@/features/settings/actions";

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
  const [pending, startTransition] = useTransition();

  function toggle(next: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await toggleEmergencyStopAction(next, next ? stopReason || null : null);
      if (result.error) setError(result.error);
    });
  }

  if (active) {
    return (
      <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-danger bg-danger-muted p-4">
        <div className="flex items-center gap-2 text-danger">
          <AlertTriangle className="size-4" aria-hidden />
          <p className="text-sm font-semibold">Emergency Stop AKTIF</p>
        </div>
        <p className="text-xs text-danger">
          Semua eksekusi tindakan Autopilot dihentikan, apa pun mode automation atau kebijakan yang aktif.
          {reason ? ` Alasan: ${reason}.` : ""}
          {activatedAt ? ` Diaktifkan ${new Date(activatedAt).toLocaleString("id-ID")}.` : ""}
        </p>
        <div>
          <Button size="sm" variant="secondary" loading={pending} onClick={() => toggle(false)}>
            Nonaktifkan Emergency Stop
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
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-end sm:gap-2">
        <Input
          value={stopReason}
          onChange={(e) => setStopReason(e.target.value)}
          placeholder="Alasan (opsional)"
          className="sm:max-w-xs"
        />
        <Button size="sm" variant="destructive" loading={pending} onClick={() => toggle(true)}>
          <ShieldOff />
          Aktifkan Emergency Stop
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Menghentikan seketika semua eksekusi tindakan Autopilot untuk tenant ini — berlaku terlepas dari mode
        automation atau kebijakan yang aktif.
      </p>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
