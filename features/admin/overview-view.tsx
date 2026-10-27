import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { DemoBanner, KeyValueRow, PageTitle, Section, StatCard, StatusBadge } from "@/features/admin/ui";
import { formatRupiah, monthLabel } from "@/lib/admin/format";
import { visibleAdminNav } from "@/lib/admin/nav";
import { can, type AdminPrincipal } from "@/lib/admin/permissions";
import type { PeriodSummary } from "@/lib/finance";

export function OverviewView({
  principal,
  summary,
  demo,
}: {
  principal: AdminPrincipal;
  summary: PeriodSummary | null;
  demo: boolean;
}) {
  const modules = visibleAdminNav(principal).filter((item) => item.href !== "/admin");
  const lateCount = summary ? summary.reconciliation.rows.filter((r) => r.status === "SETTLEMENT_LATE").length : 0;

  return (
    <div className="flex flex-col gap-4">
      {demo ? <DemoBanner /> : null}
      <PageTitle title="Ringkasan" description="Pusat pengelolaan internal PT Tanyopo Future Technology." />

      {summary && can(principal, "finance.view") ? (
        <Section title={`Keuangan · ${monthLabel(summary.range.from.slice(0, 7))}`} description="Ringkas; buka Keuangan untuk rincian.">
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Pendapatan diakui" value={formatRupiah(summary.recognizedNet)} tone="success" />
            <StatCard label="Dana sudah settle" value={formatRupiah(summary.settledNet)} />
            <StatCard label="Belum settle" value={formatRupiah(summary.unsettled)} tone={lateCount > 0 ? "danger" : "neutral"} />
            <StatCard label="Temuan perlu diperiksa" value={String(summary.anomalies.length)} tone={summary.anomalies.length > 0 ? "warning" : "neutral"} />
          </div>
        </Section>
      ) : null}

      <Section title="Modul">
        <ul className="flex flex-col divide-y divide-border">
          {modules.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link href={item.href} className="flex min-h-14 items-center gap-3 py-2">
                  <Icon className="size-5 shrink-0 text-brand" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">{item.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            );
          })}
          {modules.length === 0 ? <li className="py-2 text-sm text-muted-foreground">Belum ada modul yang diizinkan untuk akun ini.</li> : null}
        </ul>
      </Section>

      <Section title="Status platform">
        <dl>
          <KeyValueRow label="Migrasi keuangan" value="Belum diterapkan" />
          <KeyValueRow label="Midtrans" value="Belum aktif (bukan live)" />
          <KeyValueRow label="Tindakan keuangan sungguhan" value="Dinonaktifkan" />
          <KeyValueRow label="Sumber data" value="Contoh (demo)" />
        </dl>
        <div className="mt-2">
          <StatusBadge variant="warning">Fase B · pratinjau terisolasi</StatusBadge>
        </div>
      </Section>
    </div>
  );
}
