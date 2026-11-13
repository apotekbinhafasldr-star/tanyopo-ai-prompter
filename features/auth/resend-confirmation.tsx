"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { resendConfirmationAction, type ResendConfirmationState } from "@/features/auth/recovery-actions";
import { RESEND_CONFIRMATION_COOLDOWN_SECONDS } from "@/lib/auth/confirm-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: ResendConfirmationState = { outcome: "idle", message: null };

/**
 * Resend button. It is NEVER natively disabled: a focused button that becomes `disabled` drops keyboard/TalkBack focus
 * to the page body. While a request is pending or the cooldown runs it is `aria-disabled` instead, and the click (which
 * also covers Enter in the field) is cancelled so no second request is sent. The accessible name stays constant; the
 * countdown is visual only (aria-hidden) and a polite note is announced once when the cooldown ends.
 *
 * The countdown is derived from `sentAt` (no remount via `key`, no state reset inside an effect), so focus and the
 * typed address survive every state change.
 */
function ResendButton({ pending, sentAt, cooling }: { pending: boolean; sentAt?: number; cooling: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  const elapsed = cooling && sentAt !== undefined ? Math.max(0, Math.floor((now - sentAt) / 1000)) : 0;
  const secondsLeft = cooling ? Math.min(RESEND_CONFIRMATION_COOLDOWN_SECONDS, RESEND_CONFIRMATION_COOLDOWN_SECONDS - elapsed) : 0;
  const counting = secondsLeft > 0;

  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [counting]);

  const blocked = pending || counting;
  return (
    <>
      <Button
        type="submit"
        variant="outline"
        aria-disabled={blocked || undefined}
        aria-busy={pending || undefined}
        onClick={(event) => {
          if (blocked) event.preventDefault();
        }}
        className="h-auto min-h-11 w-full whitespace-normal py-2 text-center aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      >
        Kirim ulang tautan konfirmasi
        {counting ? <span aria-hidden> ({secondsLeft} detik)</span> : null}
      </Button>
      <span role="status" className="sr-only">
        {cooling && !counting && !pending ? "Anda dapat meminta tautan konfirmasi lagi." : ""}
      </span>
    </>
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
  // Controlled so the address stays visible after the action (React resets uncontrolled forms after a submit).
  const [email, setEmail] = useState(defaultEmail);
  const statusId = useId();
  const errorId = useId();
  const hasError = !pending && state.outcome === "error";
  const hasStatus = !pending && state.outcome !== "error" && state.message !== null;

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
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-11"
          aria-invalid={hasError || undefined}
          aria-describedby={hasError ? errorId : hasStatus ? statusId : undefined}
          required
        />
      </div>
      <ResendButton pending={pending} sentAt={state.sentAt} cooling={cooling} />
      {/* Emptied while pending so an identical answer is announced again on the next request. */}
      <p id={statusId} role="status" className="text-sm text-muted-foreground">
        {hasStatus ? state.message : null}
      </p>
      <p id={errorId} role="alert" className="text-sm text-danger">
        {hasError ? state.message : null}
      </p>
    </form>
  );
}
