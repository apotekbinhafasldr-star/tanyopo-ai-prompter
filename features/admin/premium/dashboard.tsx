import type { DashboardModel } from "@/lib/admin/dashboard-model";
import { STATUS_FILTERS, STATUS_LABEL } from "@/lib/admin/filters";
import { TrendChart } from "./charts";
import { Badge, Card, Check, Chip, DemoNotice, Empty, Frame, Hero, KpiCard, Row } from "./parts";

const href = (period: string, status: string) => `/admin/finance?period=${period}&status=${status}`;

const TONE = { SETTLED: "good", UNSETTLED: "warn", REFUNDED: "info", ANOMALY: "bad" } as const;

export function FinanceDashboard({ model }: { model: DashboardModel }) {
  return (
    <Frame>
      {model.demo ? <DemoNotice /> : null}
      <Hero title="Keuangan LINOE" subtitle={`${model.period.label} · ${model.period.from} s.d. ${model.period.to} · Draf`} />

      <nav aria-label="Periode" className="fin-chips">
        {model.periods.map((p) => (
          <Chip key={p.key} href={href(p.key, model.status)} current={p.key === model.period.key}>
            {p.label}
          </Chip>
        ))}
      </nav>

      <div className="fin-grid">
        {model.kpis.map((k) => (
          <KpiCard key={k.id} kpi={k} />
        ))}
      </div>

      <Card title="Tren bulanan" sub="Ketuk bulan untuk melihat angka pastinya. Data dari jurnal akuntansi.">
        {model.months.length === 0 ? (
          <Empty title="Belum ada data bulanan">Grafik muncul setelah ada transaksi terverifikasi.</Empty>
        ) : (
          <TrendChart points={model.months} initialKey={model.period.key === "ytd" ? model.months[model.months.length - 1].key : model.period.key} />
        )}
      </Card>

      <div className="fin-split">
        <Card title="Transaksi" sub={`${model.period.label}`}>
          <nav aria-label="Status" className="fin-chips">
            {STATUS_FILTERS.map((s) => (
              <Chip key={s} href={href(model.period.key, s)} current={s === model.status}>
                {STATUS_LABEL[s]} <small>{model.statusCounts[s]}</small>
              </Chip>
            ))}
          </nav>
          {model.transactions.length === 0 ? (
            <Empty title="Tidak ada transaksi">
              {model.status === "ALL" ? "Belum ada pembayaran terverifikasi pada periode ini." : "Tidak ada transaksi dengan status ini. Coba filter lain."}
            </Empty>
          ) : (
            <div className="fin-list" data-testid="tx-list">
              {model.transactions.map((t) => (
                <div className="fin-tx" key={t.id}>
                  <div className="top">
                    <span className="id">{t.id}</span>
                    <Badge tone={TONE[t.status]}>{t.statusLabel}</Badge>
                  </div>
                  <div className="top">
                    <span className="amt">{t.amount.text}</span>
                    <span className="meta">{t.date}</span>
                  </div>
                  {t.refunded ? <p className="meta">Refund diproses: {t.refunded.text}</p> : null}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Pemeriksaan otomatis" sub="Hasil cocok-silang antara jurnal dan modul keuangan.">
          {model.checks.map((c) => (
            <Check key={c.label} ok={c.ok} label={c.label} detail={c.detail} />
          ))}
          <Row label="Perlu dicek" value={`${model.anomalyCount} item`} negative={model.anomalyCount > 0} />
          {model.warnings.map((w) => (
            <p key={w} className="fin-note warn">{w}</p>
          ))}
        </Card>
      </div>
    </Frame>
  );
}
