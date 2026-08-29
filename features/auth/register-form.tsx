"use client";

import { useActionState } from "react";
import Link from "next/link";
import { registerAction, type AuthActionState } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const initialState: AuthActionState = { error: null };

export function RegisterForm() {
  const [state, formAction, pending] = useActionState(registerAction, initialState);

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
        <CardTitle>Buat akun Tanyopo AI Promoter</CardTitle>
        <CardDescription>Mulai promosikan bisnis Anda dengan AI.</CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        <form action={formAction} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nama">Nama Anda</Label>
            <Input id="nama" name="nama" autoComplete="name" placeholder="Nama lengkap" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="namaUsaha">Nama Bisnis</Label>
            <Input
              id="namaUsaha"
              name="namaUsaha"
              autoComplete="organization"
              placeholder="Nama usaha/brand Anda"
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
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Kata Sandi</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
            <p className="text-xs text-muted-foreground">Minimal 8 karakter.</p>
          </div>
          {state.error ? (
            <p role="alert" className="text-sm text-danger">
              {state.error}
            </p>
          ) : null}
          <Button type="submit" loading={pending} className="w-full">
            Daftar Gratis
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Sudah punya akun?{" "}
          <Link href="/login" className="font-medium text-brand hover:underline">
            Masuk
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
