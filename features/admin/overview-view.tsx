import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Badge, Card, DemoNotice, Frame, Hero, Row, SummaryHero } from "@/features/admin/premium/parts";
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

  return (
    <Frame>
      {demo ? <DemoNotice /> : null}
      <Hero title="Ringkasan" subtitle="Pusat pengelolaan internal PT Tanyopo Future Technology" />

      {summary && can(principal, "finance.view") ? (
        <SummaryHero
          label={`Keuangan · ${monthLabel(summary.range.from.slice(0, 7))}`}
          value={formatRupiah(summary.recognizedNet)}
          negative={false}
          note="Pendapatan diakui bulan ini"
          items={[
            { label: "Sudah settle", value: formatRupiah(summary.settledNet) },
            { label: "Belum settle", value: formatRupiah(summary.unsettled) },
            { label: "Perlu diperiksa", value: `${summary.anomalies.length} temuan` },
          ]}
        />
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
