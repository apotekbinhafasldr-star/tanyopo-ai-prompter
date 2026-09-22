"use client";

import { useActionState } from "react";
import { resetPasswordAction, type AuthActionState } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const initialState: AuthActionState = { error: null };

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(resetPasswordAction, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Atur kata sandi baru</CardTitle>
        <CardDescription>Pilih kata sandi baru untuk akun LINOE Anda.</CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        <form action={formAction} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Kata Sandi Baru</Label>
            <PasswordInput id="password" name="password" autoComplete="new-password" minLength={8} required />
            <p className="text-xs text-muted-foreground">Minimal 8 karakter.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirmPassword">Konfirmasi Kata Sandi</Label>
            <PasswordInput
              id="confirmPassword"
              name="confirmPassword"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          {state.error ? (
            <p role="alert" className="text-sm text-danger">
              {state.error}
            </p>
          ) : null}
          <Button type="submit" loading={pending} className="w-full">
            Simpan Kata Sandi Baru
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
