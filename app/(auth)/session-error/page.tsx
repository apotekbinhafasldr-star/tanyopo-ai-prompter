import type { Metadata } from "next";
import Link from "next/link";
import { logoutAction } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Masalah Akun — LINOE",
};

/**
 * Reached only when a valid Supabase session exists but its matching
 * user_profiles/tenant row can't be resolved (see services/session.ts) —
 * e.g. account provisioning from registration hasn't finished yet, or the
 * row was never created. Gives the user a real way out instead of the
 * silent /login <-> /dashboard bounce this replaces.
 */
export default function SessionErrorPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Akun Anda belum siap</CardTitle>
        <CardDescription>
          Kami berhasil memverifikasi login Anda, tetapi belum bisa memuat data akun/workspace Anda.
          Ini biasanya sementara — coba keluar lalu masuk kembali dalam beberapa menit.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-6">
        <form action={logoutAction}>
          <Button type="submit" className="w-full">
            Keluar dan coba lagi
          </Button>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          Masalah berlanjut?{" "}
          <Link href="/login" className="font-medium text-brand hover:underline">
            Kembali ke halaman masuk
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
