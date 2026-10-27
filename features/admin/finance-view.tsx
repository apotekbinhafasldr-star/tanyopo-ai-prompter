import { DemoBanner, DisabledAction, KeyValueRow, Notice, PageTitle, Section, StatCard, StatusBadge } from "@/features/admin/ui";
import { formatRupiah, monthLabel, shortDate } from "@/lib/admin/format";
import type { AnomalyCode, PaymentSettlementStatus, PeriodSummary } from "@/lib/finance";

const STATUS: Record<PaymentSettlementStatus, { label: string; variant: "success" | "warning" | "danger" | "neutral" | "info" }> = {
  SETTLED: { label: "Sudah settle", variant: "success" },
  UNSETTLED: { label: "Menunggu settle", variant: "info" },
  SETTLEMENT_LATE: { label: "Settle terlambat", variant: "danger" },
  AMOUNT_MISMATCH: { label: "Selisih jumlah", variant: "warning" },
  FULLY_REFUNDED: { label: "Direfund penuh", variant: "neutral" },
};

export const ANOMALY_LABEL: Record<AnomalyCode, string> = {
  DUPLICATE_PAYMENT_FOR_INVOICE: "Invoice dibayar lebih dari sekali",
  OVER_REFUND: "Refund melebihi saldo pembayaran",
  REFUND_FOR_UNKNOWN_PAYMENT: "Refund untuk pembayaran yang tidak dikenal",
  FEE_FOR_UNKNOWN_PAYMENT: "Fee untuk pembayaran yang tidak dikenal",
  SETTLEMENT_ITEM_UNKNOWN_PAYMENT: "Settlement memuat pembayaran yang tidak dikenal",
  SETTLEMENT_AMOUNT_MISMATCH: "Jumlah settlement tidak sama dengan pembayaran",
  SETTLEMENT_TOTAL_MISMATCH: "Total item settlement tidak sama dengan header",
  SETTLEMENT_NET_MISMATCH: "Net settlement tidak sama dengan bruto - fee - refund",
  PAYMENT_SETTLED_TWICE: "Pembayaran muncul di dua settlement",
};

/**
 * Finance dashboard body. Four layers are shown side by side and never summed
 * into one "revenue" number: verified payments, recognised revenue, settled
 * funds and still-unsettled money.
 */
export function FinanceView({ summary, demo }: { summary: PeriodSummary; demo: boolean }) {
  const period = monthLabel(summary.range.from.slice(0, 7));
  const pnl = summary.simplePnl;
  const lateCount = summary.reconciliation.rows.filter((r) => r.status === "SETTLEMENT_LATE").length;

  return (
    <div className="flex flex-col gap-4">
      {demo ? <DemoBanner /> : null}
      <PageTitle title="Keuangan" description={`Periode ${period} · semua angka dalam ${summary.currency}`} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Pembayaran terverifikasi" value={formatRupiah(summary.grossVerified)} hint={`${summary.paymentCount} pembayaran`} />
        <StatCard label="Pendapatan diakui" value={formatRupiah(summary.recognizedNet)} hint="Setelah refund, per hari layanan" tone="success" />
        <StatCard label="Dana sudah settle" value={formatRupiah(summary.settledNet)} hint="Neto dari gateway" />
        <StatCard
          label="Belum settle"
          value={formatRupiah(summary.unsettled)}
          hint={lateCount > 0 ? `${lateCount} terlambat` : "Tidak ada yang terlambat"}
          tone={lateCount > 0 ? "danger" : "neutral"}
        />
      </div>

      <Notice tone="info">
        Pembayaran, pendapatan diakui, dan dana settle adalah tiga hal berbeda dan tidak dijumlahkan. Pendapatan diakui
        memakai aturan sementara (rata per hari) sampai akuntan mengonfirmasi.
      </Notice>

      <Section title="Laba-rugi sederhana" description="Bukan perhitungan pajak.">
        <dl>
          <KeyValueRow label="Pendapatan diakui" value={formatRupiah(pnl.recognizedNet)} />
          <KeyValueRow label="Fee gateway" value={`- ${formatRupiah(pnl.gatewayFees)}`} />
          <KeyValueRow label="Pengeluaran operasional" value={`- ${formatRupiah(pnl.operatingExpenses)}`} />
          <KeyValueRow label="Hasil operasional" value={formatRupiah(pnl.operatingResult)} strong />
        </dl>
      </Section>

      <Section title="Arus kas aktual" description="Hanya uang yang benar-benar masuk dan keluar.">
        <dl>
          <KeyValueRow label="Masuk (settlement neto)" value={formatRupiah(summary.cashFlow.inflowSettled)} />
          <KeyValueRow label="Keluar (pengeluaran)" value={`- ${formatRupiah(summary.cashFlow.outflowExpenses)}`} />
          <KeyValueRow label="Arus kas bersih" value={formatRupiah(summary.cashFlow.net)} strong />
          <KeyValueRow label="Refund diproses (info)" value={formatRupiah(summary.refundsProcessed)} />
        </dl>
      </Section>

      <Section title="Rekonsiliasi pembayaran" description="Status setiap pembayaran terhadap laporan settlement.">
        <ul className="flex flex-col divide-y divide-border">
          {summary.reconciliation.rows.map((row) => {
            const status = STATUS[row.status];
            return (
              <li key={`${row.provider}|${row.providerPaymentId}`} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-foreground">{row.providerPaymentId}</p>
                  <StatusBadge variant={status.variant}>{status.label}</StatusBadge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {shortDate(row.paidDate)} · bruto {formatRupiah(row.gross)} · fee {formatRupiah(row.gatewayFee)}
                  {row.feeKnown ? "" : " (belum diketahui)"} · diharapkan masuk {formatRupiah(row.expectedNet)}
                </p>
                {row.settledAt ? (
                  <p className="text-xs text-muted-foreground">
                    Settlement {row.settlementId}
                    {row.settledLate ? " · datang terlambat" : ""}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="Perlu diperiksa" description={`${summary.anomalies.length} temuan`}>
        {summary.anomalies.length === 0 ? (
          <p className="text-sm text-muted-foreground">Tidak ada temuan.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {summary.anomalies.map((a, i) => (
              <li key={`${a.code}-${i}`} className="flex flex-col gap-1">
                <StatusBadge variant="warning">{ANOMALY_LABEL[a.code]}</StatusBadge>
                <p className="text-xs text-muted-foreground">Referensi: {a.refs.join(", ")}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Tindakan">
        <div className="grid gap-3 md:grid-cols-2">
          <DisabledAction label="Ekspor CSV" reason="Belum aktif di Fase B. Ekspor akan memakai pengaman formula spreadsheet." />
          <DisabledAction label="Setujui refund" reason="Dinonaktifkan: tindakan keuangan sungguhan tidak tersedia di Fase B." />
        </div>
      </Section>
    </div>
  );
}
