"use client";

import { useActionState, useEffect, useState } from "react";
import { resendConfirmationAction, type ResendConfirmationState } from "@/features/auth/recovery-actions";
import { RESEND_CONFIRMATION_COOLDOWN_SECONDS } from "@/lib/auth/confirm-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: ResendConfirmationState = { outcome: "idle", message: null };

/**
 * One-second countdown, remounted via `key` whenever a request is accepted so it always restarts from the full
 * cooldown (same pattern as verify-otp-form). Before the first request the button is simply enabled.
 */
function ResendButton({ pending, cooling }: { pending: boolean; cooling: boolean }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!cooling) return;
    const id = setInterval(
      () => setElapsed((value) => Math.min(value + 1, RESEND_CONFIRMATION_COOLDOWN_SECONDS)),
      1000,
    );
    return () => clearInterval(id);
  }, [cooling]);

  const secondsLeft = cooling ? RESEND_CONFIRMATION_COOLDOWN_SECONDS - elapsed : 0;
  return (
    <Button
      type="submit"
      variant="outline"
      className="min-h-11 w-full"
      disabled={secondsLeft > 0 || pending}
      loading={pending}
    >
      {secondsLeft > 0 ? `Kirim ulang tautan (${secondsLeft} dtk)` : "Kirim ulang tautan konfirmasi"}
    </Button>
  );
}

/**
 * Asks for a new signup confirmation link. The answer is identical for every address (see recovery-actions.ts), so this
 * form never says whether an account exists. Used on /login after a failed confirmation link and after a sign-in that
 * was refused because the email is not confirmed yet.
 */
export function ResendConfirmation({ defaultEmail = "" }: { defaultEmail?: string }) {
  const [state, formAction, pending] = useActionState(resendConfirmationAction, initialState);
  const cooling = state.outcome === "sent" || state.outcome === "uncertain";

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-3 border-t border-border pt-6" noValidate>
      <p className="text-sm font-medium text-foreground">Belum menerima email konfirmasi?</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="resendEmail">Email pendaftaran</Label>
        <Input
          id="resendEmail"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="nama@usaha.com"
          defaultValue={defaultEmail}
          className="h-11"
          required
        />
      </div>
      <ResendButton key={state.sentAt ?? "initial"} pending={pending} cooling={cooling} />
      <p
        role={state.outcome === "error" ? "alert" : "status"}
        className={state.outcome === "error" ? "text-sm text-danger" : "text-sm text-muted-foreground"}
      >
        {state.message}
      </p>
    </form>
  );
}
