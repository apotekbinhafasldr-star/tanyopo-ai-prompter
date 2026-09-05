import type { Metadata } from "next";
import { User, Building2, ShieldCheck, Bot, Globe, ShieldAlert } from "lucide-react";
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

export const metadata: Metadata = { title: "Settings — LINOE" };

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
            Pengaturan brand, tim, dan API akan tersedia pada fase pengembangan berikutnya.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <Globe className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle>{dictionary.onboarding.globalStepTitle}</CardTitle>
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

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle>Budget Guard</CardTitle>
          <CardDescription className="sr-only">
            Batas budget yang diperiksa sebelum campaign diajukan
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <BudgetPolicyForm policy={budgetPolicy} readOnly={!isOwner} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <Bot className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle>Automation &amp; Autopilot</CardTitle>
          <CardDescription className="sr-only">
            Mode automation, kebijakan autopilot, dan Emergency Stop
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6 pt-4">
          <EmergencyStopButton
            active={automationSettings.emergency_stop_active}
            activatedAt={automationSettings.emergency_stop_activated_at}
            reason={automationSettings.emergency_stop_reason}
          />

          <div className="border-t border-border pt-4">
            <AutomationModeForm currentMode={automationSettings.automation_mode} readOnly={!isOwner} />
          </div>

          <div className="border-t border-border pt-4">
            <p className="mb-3 text-sm font-medium text-foreground">Kebijakan Autopilot</p>
            <AutopilotPolicyToggles
              policies={autopilotPolicies ?? []}
              automationMode={automationSettings.automation_mode}
              readOnly={!isOwner}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <ShieldAlert className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle>Compliance Readiness</CardTitle>
          <CardDescription className="sr-only">
            Status kesiapan compliance per area — bukan jaminan kepatuhan penuh
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <p className="mb-3 text-xs text-muted-foreground">
            Status ini adalah metadata kesiapan yang Anda tetapkan sendiri — bukan penilaian hukum otomatis dari
            AI atau sistem. &quot;Belum Dikonfigurasi&quot; secara default untuk setiap area.
          </p>
          <ComplianceFlagsForm flags={complianceFlags} readOnly={!isOwner} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <Globe className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle>Global Edition Feature Flags</CardTitle>
          <CardDescription className="sr-only">
            Kontrol opt-in per fitur Global Edition untuk tenant ini
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <p className="mb-3 text-xs text-muted-foreground">
            Tidak aktif secara default — mengaktifkan salah satu tidak memengaruhi tenant lain.
          </p>
          <FeatureFlagToggles flags={featureFlags} readOnly={!isOwner} />
        </CardContent>
      </Card>
    </div>
  );
}
