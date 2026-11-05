"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { registerAction, type AuthActionState } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { validateEmailFormat } from "@/schemas/auth";
import { LegalLinks } from "@/features/legal/legal-links";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const initialState: AuthActionState = { error: null };

export function RegisterForm() {
  const [state, formAction, pending] = useActionState(registerAction, initialState);
  // "Gunakan email lain" hides the existing-account card for THIS result only; a new submit produces a new state
  // object, so the card shows again if that email is also registered.
  const [dismissed, setDismissed] = useState<AuthActionState | null>(null);
  // Format check on leaving the email field. Pure client-side: no request, no server action, no lookup of any kind.
  const [emailError, setEmailError] = useState<string | null>(null);

  if (state.existingAccount && dismissed !== state) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Email sudah terdaftar</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-6">
          <p className="text-sm text-foreground">
            Email ini sudah terdaftar. Masuk dengan akun Anda, atau atur ulang kata sandi bila lupa. Data yang Anda isi tidak mengubah akun yang ada.
          </p>
          <Button asChild className="w-full">
            <Link href="/login">Masuk ke akun Anda</Link>
          </Button>
          <Link href="/forgot-password" className="text-center text-sm font-medium text-brand hover:underline">
            Lupa kata sandi?
          </Link>
          <Button type="button" variant="outline" className="w-full" onClick={() => setDismissed(state)}>
            Gunakan email lain
          </Button>
        </CardContent>
      </Card>
    );
  }

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
        <CardTitle>Buat akun LINOE</CardTitle>
        <CardDescription>Mulai promosikan bisnis Anda dengan AI.</CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        <form key={JSON.stringify(state.values ?? null)} action={formAction} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nama">Nama Anda</Label>
            <Input id="nama" name="nama" autoComplete="name" placeholder="Nama lengkap" defaultValue={state.values?.nama} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="namaUsaha">Nama Bisnis</Label>
            <Input
              id="namaUsaha"
              name="namaUsaha"
              autoComplete="organization"
              placeholder="Nama usaha/brand Anda"
              defaultValue={state.values?.namaUsaha}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="nama@usaha.com"
              defaultValue={state.values?.email}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? "email-error email-hint" : "email-hint"}
              onBlur={(event) => setEmailError(validateEmailFormat(event.currentTarget.value))}
              onChange={(event) => {
                if (emailError && validateEmailFormat(event.currentTarget.value) === null) setEmailError(null);
              }}
              required
            />
            {emailError ? (
              <p id="email-error" role="alert" className="text-xs text-danger">
                {emailError}
              </p>
            ) : null}
            <p id="email-hint" className="text-xs text-muted-foreground">
              Sudah punya akun?{" "}
              <Link href="/login" className="font-medium text-brand hover:underline">
                Masuk
              </Link>
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Kata Sandi</Label>
            <PasswordInput id="password" name="password" autoComplete="new-password" minLength={8} required />
            <p className="text-xs text-muted-foreground">Minimal 8 karakter.</p>
          </div>
          <div className="flex items-start gap-2.5">
            <input
              id="acceptLegal"
              name="acceptLegal"
              type="checkbox"
              required
              defaultChecked={false}
              className="mt-0.5 size-4 shrink-0 rounded border-border accent-[var(--color-brand,currentColor)]"
            />
            <Label htmlFor="acceptLegal" className="text-xs font-normal leading-relaxed text-muted-foreground">
              Saya telah membaca dan menyetujui{" "}
              <Link href="/terms" target="_blank" className="font-medium text-foreground hover:underline">
                Syarat &amp; Ketentuan
              </Link>{" "}
              dan{" "}
              <Link href="/privacy" target="_blank" className="font-medium text-foreground hover:underline">
                Kebijakan Privasi
              </Link>
              .
            </Label>
          </div>
          {state.error ? (
            <div role="alert" className="flex flex-col gap-2 text-sm text-danger">
              <p>{state.error}</p>
              {state.uncertain ? (
                <p className="flex gap-4 text-xs">
                  <Link href="/login" className="font-medium text-brand hover:underline">
                    Masuk
                  </Link>
                  <Link href="/forgot-password" className="font-medium text-brand hover:underline">
                    Lupa kata sandi?
                  </Link>
                </p>
              ) : null}
            </div>
          ) : null}
          <Button type="submit" loading={pending} className="w-full">
            Daftar Gratis
          </Button>
        </form>
        <LegalLinks className="mt-2 text-center text-xs text-muted-foreground [&_ul]:justify-center" />
      </CardContent>
    </Card>
  );
}
