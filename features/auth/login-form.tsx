"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginAction, type AuthActionState } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CONFIRM_NOTICE_MESSAGES, type ConfirmNoticeCode } from "@/lib/auth/confirm-notice";

const initialState: AuthActionState = { error: null };

export function LoginForm({
  next,
  resetSuccess,
  notice,
}: {
  next?: string;
  resetSuccess?: boolean;
  notice?: ConfirmNoticeCode | null;
}) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Masuk ke akun Anda</CardTitle>
        <CardDescription>Kelola promosi dan campaign AI Anda.</CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        {resetSuccess ? (
          <p className="mb-4 rounded-[var(--radius-md)] border border-brand/30 bg-brand/5 p-3 text-sm text-foreground">
            Kata sandi Anda berhasil diperbarui. Silakan masuk dengan kata sandi baru.
          </p>
        ) : null}
        {notice ? (
          <div className="mb-4 rounded-[var(--radius-md)] border border-border bg-surface-muted p-3 text-sm text-foreground">
            <p>{CONFIRM_NOTICE_MESSAGES[notice]}</p>
            <Link
              href="/forgot-password"
              className="mt-2 inline-flex min-h-11 items-center font-medium text-brand underline-offset-4 hover:underline"
            >
              Lupa kata sandi? Atur ulang di sini
            </Link>
          </div>
        ) : null}
        <form action={formAction} className="flex flex-col gap-4" noValidate>
          {next ? <input type="hidden" name="next" value={next} /> : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="nama@usaha.com"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Kata Sandi</Label>
              <Link href="/forgot-password" className="text-xs font-medium text-brand hover:underline">
                Lupa kata sandi?
              </Link>
            </div>
            <PasswordInput id="password" name="password" autoComplete="current-password" required />
          </div>
          {state.error ? (
            <p role="alert" className="text-sm text-danger">
              {state.error}
            </p>
          ) : null}
          {/* Always in the DOM so the polite announcement works; emptied while pending so an identical answer is read again. */}
          <p role="status" className="text-sm text-foreground empty:hidden">
            {pending ? null : state.info}
          </p>
          <Button type="submit" loading={pending} className="w-full">
            Masuk
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Belum punya akun?{" "}
          <Link href="/register" className="font-medium text-brand hover:underline">
            Daftar gratis
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
