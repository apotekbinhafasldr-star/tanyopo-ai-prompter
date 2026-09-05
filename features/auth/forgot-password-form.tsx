"use client";

import { useActionState } from "react";
import Link from "next/link";
import { forgotPasswordAction, type AuthActionState } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const initialState: AuthActionState = { error: null };

export function ForgotPasswordForm({ expiredLink }: { expiredLink?: boolean }) {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, initialState);

  if (state.info) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cek email Anda</CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <p className="text-sm text-foreground">{state.info}</p>
          <Link href="/login" className="mt-6 inline-block text-sm font-medium text-brand hover:underline">
            Kembali ke halaman masuk
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lupa kata sandi?</CardTitle>
        <CardDescription>
          Masukkan email akun Anda — kami akan mengirimkan tautan untuk mengatur ulang kata sandi.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        {expiredLink ? (
          <p role="alert" className="mb-4 rounded-[var(--radius-md)] border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            Tautan reset kata sandi sebelumnya sudah kedaluwarsa atau tidak valid. Silakan minta tautan baru di bawah ini.
          </p>
        ) : null}
        <form action={formAction} className="flex flex-col gap-4" noValidate>
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
          {state.error ? (
            <p role="alert" className="text-sm text-danger">
              {state.error}
            </p>
          ) : null}
          <Button type="submit" loading={pending} className="w-full">
            Kirim Tautan Reset
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Ingat kata sandi Anda?{" "}
          <Link href="/login" className="font-medium text-brand hover:underline">
            Masuk
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
