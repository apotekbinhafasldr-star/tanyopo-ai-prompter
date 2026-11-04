import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Badge, Card, DemoNotice, Frame, Hero, Row } from "@/features/admin/premium/parts";
import { formatRupiah, monthLabel } from "@/lib/admin/format";
import { visibleAdminNav } from "@/lib/admin/nav";
import { can, type AdminPrincipal } from "@/lib/admin/permissions";
import type { PeriodSummary } from "@/lib/finance";

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "neg" }) {
  return (
    <div className="fin-card fin-kpi">
      <p className="k">{label}</p>
      <p className={`v${tone === "neg" ? " neg" : ""}`}>{value}</p>
    </div>
  );
}

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
    <Frame>
      {demo ? <DemoNotice /> : null}
      <Hero title="Ringkasan" subtitle="Pusat pengelolaan internal PT Tanyopo Future Technology" />

      {summary && can(principal, "finance.view") ? (
        <Card title={`Keuangan · ${monthLabel(summary.range.from.slice(0, 7))}`} sub="Ringkas; buka Keuangan untuk rincian.">
          <div className="fin-grid">
            <Kpi label="Pendapatan diakui" value={formatRupiah(summary.recognizedNet)} />
            <Kpi label="Dana sudah settle" value={formatRupiah(summary.settledNet)} />
            <Kpi label="Belum settle" value={formatRupiah(summary.unsettled)} tone={lateCount > 0 ? "neg" : undefined} />
            <Kpi label="Perlu diperiksa" value={`${summary.anomalies.length} temuan`} tone={summary.anomalies.length > 0 ? "neg" : undefined} />
          </div>
        </Card>
      ) : null}

      <Card title="Modul">
        {modules.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className="fin-mod" prefetch={false}>
              <span className="fin-ic">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="tx">
                <span className="t">{item.label}</span>
                <span className="d">{item.description}</span>
              </span>
              <ChevronRight className="chev size-4" aria-hidden />
            </Link>
          );
        })}
        {modules.length === 0 ? <p className="fin-note">Belum ada modul yang diizinkan untuk akun ini.</p> : null}
      </Card>

      <Card title="Status platform">
        <Row label="Migrasi keuangan" value="Belum diterapkan" />
        <Row label="Midtrans" value="Belum aktif (bukan live)" />
        <Row label="Tindakan keuangan sungguhan" value="Dinonaktifkan" />
        <Row label="Sumber data" value="Contoh (demo)" />
        <div>
          <Badge tone="warn">Fase B · pratinjau terisolasi</Badge>
        </div>
      </Card>
    </Frame>
  );
}
