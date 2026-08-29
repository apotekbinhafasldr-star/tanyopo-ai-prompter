import type { Metadata } from "next";
import { User, Building2, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireSessionContext } from "@/services/session";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateBudgetPolicy } from "@/services/budget-guard";
import { BudgetPolicyForm } from "@/features/settings/budget-policy-form";

export const metadata: Metadata = { title: "Settings — Tanyopo AI Promoter" };

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  marketing: "Marketing",
  apoteker: "Apoteker",
  kasir: "Kasir",
  admin_gudang: "Admin Gudang",
  hr: "HR",
};

export default async function SettingsPage() {
  const session = await requireSessionContext({ allowIncompleteOnboarding: true });
  const supabase = await createClient();
  const budgetPolicy = await getOrCreateBudgetPolicy(supabase, session.tenantId);

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Profil, organisasi, dan preferensi akun Anda.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <User className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle>Profil</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Nama</dt>
              <dd className="text-sm font-medium text-foreground">{session.userName}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Email</dt>
              <dd className="text-sm font-medium text-foreground">{session.email ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Peran</dt>
              <dd className="mt-1">
                <Badge variant="brand">{ROLE_LABEL[session.role] ?? session.role}</Badge>
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <Building2 className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle>Organisasi</CardTitle>
          <CardDescription className="sr-only">Data bisnis Anda</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <dl>
            <dt className="text-xs text-muted-foreground">Nama Bisnis</dt>
            <dd className="text-sm font-medium text-foreground">{session.businessName}</dd>
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            Pengaturan brand, tim, otomasi, dan API akan tersedia pada fase pengembangan
            berikutnya.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle>Budget Guard</CardTitle>
          <CardDescription className="sr-only">
            Batas budget yang diperiksa sebelum campaign diajukan
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <BudgetPolicyForm policy={budgetPolicy} readOnly={session.role !== "owner"} />
        </CardContent>
      </Card>
    </div>
  );
}
