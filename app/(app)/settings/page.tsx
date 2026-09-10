import type { Metadata } from "next";
import { User, ShieldCheck, Bot, Globe, ShieldAlert, Power, ChevronRight, SlidersHorizontal } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireSessionContext } from "@/services/session";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateBudgetPolicy } from "@/services/budget-guard";
import { getOrCreateAutomationSettings } from "@/services/automation-settings";
import { BudgetPolicyForm } from "@/features/settings/budget-policy-form";
import { AutomationModeForm } from "@/features/settings/automation-mode-form";
import { EmergencyStopButton } from "@/features/settings/emergency-stop-button";
import { AutopilotPolicyToggles } from "@/features/settings/autopilot-policy-toggles";
import { GlobalPreferencesForm } from "@/features/settings/global-preferences-form";
import { FeatureFlagToggles } from "@/features/settings/feature-flag-toggles";
import { ComplianceFlagsForm } from "@/features/settings/compliance-flags-form";
import { getDictionary } from "@/lib/i18n/dictionary";
import { DEFAULT_LOCALE } from "@/lib/i18n/config";
import { getFeatureFlags } from "@/lib/feature-flags";
import { listComplianceFlags } from "@/services/compliance";

export const metadata: Metadata = { title: "Pengaturan — LINOE" };

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  marketing: "Marketing",
  apoteker: "Apoteker",
  kasir: "Kasir",
  admin_gudang: "Admin Gudang",
  hr: "HR",
};

/**
 * Batch B9 — Settings UX simplification. This page reuses every existing
 * service/action/schema/component from B0-B8 as-is (no new persistence,
 * no new server actions, no schema change) and only reorganizes
 * presentation: plain-Indonesian section titles, essential settings
 * visible by default, and the more technical/rarely-touched controls
 * (Autopilot policy toggles, Compliance Readiness, Global Edition feature
 * flags) tucked into a collapsed "Pengaturan Lanjutan" disclosure so a
 * first-time UMKM owner isn't shown a technical dashboard up front.
 */
export default async function SettingsPage() {
  const session = await requireSessionContext({ allowIncompleteOnboarding: true });
  const supabase = await createClient();

  const [
    budgetPolicy,
    automationSettings,
    { data: autopilotPolicies },
    { data: brandProfile },
    featureFlags,
    complianceFlags,
  ] = await Promise.all([
    getOrCreateBudgetPolicy(supabase, session.tenantId),
    getOrCreateAutomationSettings(supabase, session.tenantId),
    supabase
      .from("prompter_autopilot_policies")
      .select("policy_type, enabled")
      .eq("tenant_id", session.tenantId),
    supabase
      .from("prompter_brand_profiles")
      .select("country_code, default_language, default_timezone, default_currency")
      .eq("tenant_id", session.tenantId)
      .maybeSingle(),
    getFeatureFlags(supabase, session.tenantId),
    listComplianceFlags(supabase, session.tenantId),
  ]);

  const dictionary = await getDictionary(session.locale);
  const isOwner = session.role === "owner";
  const isOwnerOrMarketing = session.role === "owner" || session.role === "marketing";

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Pengaturan</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Profil, bisnis, dan cara LINOE membantu pemasaran Anda.
        </p>
      </div>

      {/* 1. Profil & Bisnis — merged Profil + Organisasi. No internal
          ID/tenant ID is shown to the end user; only human-facing fields. */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <User className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle>Profil &amp; Bisnis</CardTitle>
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
            <div>
              <dt className="text-xs text-muted-foreground">Nama Bisnis</dt>
              <dd className="text-sm font-medium text-foreground">{session.businessName}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            Pengaturan brand, tim, dan API akan tersedia pada fase pengembangan berikutnya.
          </p>
        </CardContent>
      </Card>

      {/* 2. Pasar & Lokasi — existing GlobalPreferencesForm/action, untouched. */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <Globe className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle>Pasar &amp; Lokasi</CardTitle>
          <CardDescription className="sr-only">Negara, bahasa, zona waktu, dan mata uang bisnis</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <GlobalPreferencesForm
            countryCode={brandProfile?.country_code ?? "ID"}
            language={brandProfile?.default_language ?? DEFAULT_LOCALE}
            timezone={brandProfile?.default_timezone ?? "Asia/Jakarta"}
            currency={brandProfile?.default_currency ?? "IDR"}
            dictionary={dictionary}
            readOnly={!isOwnerOrMarketing}
          />
        </CardContent>
      </Card>

      {/* 3. Batas Pengeluaran Promosi (was "Budget Guard") + 4. Persetujuan
          Pengeluaran (was "Approval Threshold") — both fields live in the
          same prompter_budget_policies row and the same
          updateBudgetPolicyAction, so BudgetPolicyForm keeps them as one
          form/one save, presented as two clearly labeled groups. */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle>Batas Pengeluaran Promosi</CardTitle>
          <CardDescription className="sr-only">
            Batas budget yang diperiksa sebelum campaign diajukan, dan kapan LINOE meminta persetujuan Anda
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <BudgetPolicyForm policy={budgetPolicy} readOnly={!isOwner} />
        </CardContent>
      </Card>

      {/* 5. Otomatisasi LINOE — Automation Mode only. Same
          updateAutomationModeAction/enum, plain-language labels only. */}
      <Card>
        <CardHeader className="flex flex-col gap-1 space-y-0">
          <div className="flex flex-row items-center gap-2">
            <Bot className="size-4 text-muted-foreground" aria-hidden />
            <CardTitle>Otomatisasi LINOE</CardTitle>
          </div>
          <CardDescription>
            Atur seberapa jauh LINOE boleh membantu menjalankan dan mengoptimalkan pemasaran Anda.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <AutomationModeForm currentMode={automationSettings.automation_mode} readOnly={!isOwner} />
        </CardContent>
      </Card>

      {/* 6. Emergency Stop — kept as its own visible section (never hidden
          in Advanced), same toggleEmergencyStopAction/logic. */}
      <Card>
        <CardHeader className="flex flex-col gap-1 space-y-0">
          <div className="flex flex-row items-center gap-2">
            <Power className="size-4 text-muted-foreground" aria-hidden />
            <CardTitle>Hentikan Semua Otomatisasi</CardTitle>
          </div>
          <CardDescription>
            Gunakan ini jika Anda ingin menghentikan sementara tindakan otomatis LINOE.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <EmergencyStopButton
            active={automationSettings.emergency_stop_active}
            activatedAt={automationSettings.emergency_stop_activated_at}
            reason={automationSettings.emergency_stop_reason}
          />
        </CardContent>
      </Card>

      {/* Pengaturan Lanjutan — technical/rarely-touched controls, same
          components/actions as before, just tucked away by default so a
          first-time UMKM owner isn't shown a technical dashboard. Nothing
          here is removed — only collapsed. */}
      <details className="group rounded-[var(--radius-lg)] border border-border bg-surface shadow-[var(--shadow-sm)]">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 p-6 text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2">
            <SlidersHorizontal className="size-4 text-muted-foreground" aria-hidden />
            Pengaturan Lanjutan
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
        </summary>

        <div className="flex flex-col gap-6 border-t border-border p-6 pt-6">
          <div>
            <p className="mb-1 text-sm font-medium text-foreground">Kebijakan Autopilot</p>
            <p className="mb-3 text-xs text-muted-foreground">
              Pengaturan lanjutan untuk Mode Otomatis — hanya berlaku saat Otomatisasi LINOE diatur ke mode paling
              otomatis.
            </p>
            <AutopilotPolicyToggles
              policies={autopilotPolicies ?? []}
              automationMode={automationSettings.automation_mode}
              readOnly={!isOwner}
            />
          </div>

          <div className="border-t border-border pt-6">
            <div className="mb-1 flex items-center gap-2">
              <ShieldAlert className="size-4 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium text-foreground">Kesiapan Kepatuhan (Compliance)</p>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Status ini adalah catatan kesiapan yang Anda tetapkan sendiri — bukan penilaian hukum otomatis dari
              AI atau sistem. &quot;Belum Dikonfigurasi&quot; secara default untuk setiap area.
            </p>
            <ComplianceFlagsForm flags={complianceFlags} readOnly={!isOwner} />
          </div>

          <div className="border-t border-border pt-6">
            <div className="mb-1 flex items-center gap-2">
              <Globe className="size-4 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium text-foreground">Fitur Global Edition</p>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Tidak aktif secara default — mengaktifkan salah satu tidak memengaruhi bisnis lain di LINOE.
            </p>
            <FeatureFlagToggles flags={featureFlags} readOnly={!isOwner} />
          </div>
        </div>
      </details>
    </div>
  );
}
