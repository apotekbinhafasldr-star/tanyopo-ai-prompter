import type { DashboardModel } from "@/lib/admin/dashboard-model";
import { STATUS_FILTERS, STATUS_LABEL } from "@/lib/admin/filters";
import { TrendChart } from "./charts";
import { Badge, Card, Check, Chip, DemoNotice, Empty, Frame, KpiCard, ResultHero, Row } from "./parts";
import { Donut, SLICE_COLORS } from "./visuals";

const href = (period: string, status: string) => `/admin/finance?period=${period}&status=${status}`;

const TONE = { SETTLED: "good", UNSETTLED: "warn", REFUNDED: "info", ANOMALY: "bad" } as const;

export function FinanceDashboard({ model }: { model: DashboardModel }) {
  const kpi = (id: string) => model.kpis.find((k) => k.id === id);
  const result = kpi("result");
  const revenue = kpi("revenue");
  const expenses = kpi("expenses");
  return (
    <Frame>
      {model.demo ? <DemoNotice /> : null}
      <nav aria-label="Periode" className="fin-chips">
        {model.periods.map((p) => (
          <Chip key={p.key} href={href(p.key, model.status)} current={p.key === model.period.key}>
            {p.label}
          </Chip>
        ))}
      </nav>

      <div className="fin-top">
        {result && revenue && expenses ? (
          <ResultHero result={result} revenue={revenue} expenses={expenses} cash={kpi("cash")} label={`Hasil operasi, ${model.period.label}`} />
        ) : null}
        <div className="fin-grid" role="group" aria-label={`Angka utama, ${model.period.from} s.d. ${model.period.to}. Draf, belum final.`}>
          {model.kpis.filter((k) => k.id !== "result").map((k) => (
            <KpiCard key={k.id} kpi={k} />
          ))}
        </div>
      </div>

      <Card title="Tren bulanan" sub="Ketuk bulan untuk melihat angka pastinya. Data dari jurnal akuntansi.">
        {model.months.length === 0 ? (
          <Empty title="Belum ada data bulanan">Grafik muncul setelah ada transaksi terverifikasi.</Empty>
        ) : (
          <TrendChart points={model.months} initialKey={model.period.key === "ytd" ? model.months[model.months.length - 1].key : model.period.key} />
        )}
      </Card>

      <div className="fin-duo">
        <Card title="Komposisi beban" sub={model.period.label}>
          {model.expenseMix.items.length === 0 ? (
            <Empty title="Belum ada beban">Rincian muncul setelah ada beban pada periode ini.</Empty>
          ) : (
            <>
              <div className="fin-donut">
                <Donut items={model.expenseMix.items} centerLabel="Total beban" centerValue={model.expenseMix.total.text} />
                <ul>
                  {model.expenseMix.items.map((it, i) => (
                    <li key={it.key}>
                      <i style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }} />
                      {it.name}
                      <b>{it.pct}</b>
                      <span>{it.amount.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="fin-insight">{model.expenseInsight}</p>
            </>
          )}
        </Card>

        <Card title="Posisi aset" sub={`Per ${model.period.to}`}>
          {model.assetMix.items.length === 0 ? (
            <Empty title="Belum ada saldo aset">Saldo muncul setelah ada jurnal atau saldo awal.</Empty>
          ) : (
            <>
              <div className="fin-bars">
                {model.assetMix.items.map((it, i) => (
                  <div className="r" key={it.key}>
                    <span className="n">{it.name}</span>
                    <span className="b">
                      <i className={i === 0 ? "top" : undefined} style={{ width: `${Math.max(it.share * 100, 4).toFixed(1)}%` }} />
                      <b>{it.amount.text}</b>
                    </span>
                  </div>
                ))}
              </div>
              <Row label="Total aset" value={model.assetMix.total.text} total />
            </>
          )}
        </Card>
      </div>

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
