"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { resendSignupOtpAction, verifyEmailOtpAction, type OtpActionState } from "@/features/auth/otp-actions";
import { RESEND_COOLDOWN_SECONDS, sanitizeOtpInput } from "@/lib/auth/email-otp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const initialState: OtpActionState = { error: null };

/**
 * One-second countdown. It is remounted (via `key`) whenever a resend is accepted, so its only state changes happen
 * inside the interval callback and it always restarts from the full cooldown.
 */
function ResendButton({ pending }: { pending: boolean }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed((value) => Math.min(value + 1, RESEND_COOLDOWN_SECONDS)), 1000);
    return () => clearInterval(id);
  }, []);

  const secondsLeft = RESEND_COOLDOWN_SECONDS - elapsed;
  return (
    <Button type="submit" variant="outline" className="w-full" disabled={secondsLeft > 0 || pending} loading={pending}>
      {secondsLeft > 0 ? `Kirim Ulang Kode (${secondsLeft} dtk)` : "Kirim Ulang Kode"}
    </Button>
  );
}

/**
 * Stage A email-code screen, shown after a new signup only when the server-side flag is on. The email arrives as a
 * prop from the register result and is carried in hidden fields; the password is never available here. Nothing on
 * this screen says "verified" until the server action redirects after Supabase has confirmed.
 */
export function VerifyOtpForm({ email, onChangeEmail }: { email: string; onChangeEmail: () => void }) {
  const [verifyState, verifyAction, verifying] = useActionState(verifyEmailOtpAction, initialState);
  const [resendState, resendAction, resending] = useActionState(resendSignupOtpAction, initialState);
  // Controlled so typing, pasting and browser/keyboard autofill all end up as clean digits.
  const [code, setCode] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Masukkan kode verifikasi</CardTitle>
        <CardDescription>
          Kami mengirim kode ke <span data-testid="otp-email" className="font-medium text-foreground">{email}</span>. Anda
          juga bisa memakai tautan di email yang sama.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-6">
        <form action={verifyAction} className="flex flex-col gap-4">
          <input type="hidden" name="email" value={email} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="otp-token">Kode dari email</Label>
            <Input
              id="otp-token"
              name="token"
              value={code}
              onChange={(event) => setCode(sanitizeOtpInput(event.target.value))}
              inputMode="numeric"
              autoComplete="one-time-code"
              enterKeyHint="done"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              pattern="[0-9]*"
              placeholder="Masukkan kode"
              className="h-14 text-center font-mono text-2xl tracking-[0.35em] placeholder:font-sans placeholder:text-base placeholder:tracking-normal"
              required
              aria-describedby={verifyState.error ? "otp-error" : undefined}
            />
          </div>
          {verifyState.error ? (
            <p id="otp-error" role="alert" className="text-sm text-danger">
              {verifyState.error}
            </p>
          ) : null}
          <Button type="submit" loading={verifying} className="h-12 w-full text-base">
            Verifikasi Email
          </Button>
        </form>

        <form action={resendAction} className="flex flex-col gap-2">
          <input type="hidden" name="email" value={email} />
          <ResendButton key={resendState.sentAt ?? "initial"} pending={resending} />
          {resendState.error ? (
            <p role="alert" className="text-xs text-danger">
              {resendState.error}
            </p>
          ) : null}
          {resendState.info ? (
            <p role="status" className="text-xs text-muted-foreground">
              {resendState.info}
            </p>
          ) : null}
        </form>

        <div className="flex items-center justify-between text-sm">
          <button type="button" onClick={onChangeEmail} className="font-medium text-brand hover:underline">
            Salah email? Ubah
          </button>
          <Link href="/login" className="font-medium text-brand hover:underline">
            Kembali ke login
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
