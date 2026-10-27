import Link from "next/link";
import type { BankReconciliation, FiscalReconciliation, TaxPaymentRecord } from "@/lib/accounting";
import { formatRupiah, monthLabel } from "@/lib/admin/format";
import type { TurnoverRecap } from "@/lib/finance";
import type { DashboardModel } from "@/lib/admin/dashboard-model";
import { Badge, Card, Check, DemoNotice, Empty, Frame, Hero, Row } from "./parts";
import { TaxSubMenu } from "./tax-optimization";

const fmt = formatRupiah;

export interface TaxCenterProps {
  recap: TurnoverRecap;
  fiscal: FiscalReconciliation;
  taxPayments: readonly TaxPaymentRecord[];
  checks: DashboardModel["checks"];
  bank: BankReconciliation;
  canExport: boolean;
  canOptimize?: boolean;
  demo: boolean;
}

export function TaxCenter({ recap, fiscal, taxPayments, checks, bank, canExport, canOptimize = false, demo }: TaxCenterProps) {
  const seg = fiscal.segment;
  const pkp = recap.configVerified;
  return (
    <Frame>
      {demo ? <DemoNotice /> : null}
      <Hero title="Pajak dan paket Coretax" subtitle={`Tahun ${recap.year} · Data pendukung untuk akuntan · Segmen LINOE`} />
      <TaxSubMenu current="rekap" canOptimize={canOptimize} />

      <Card title="Panduan lapor pajak" sub="Langkah demi langkah ke Coretax resmi: SPT Tahunan PPh Badan dan SPT Masa PPN (jika PKP).">
        <Link className="fin-btn" style={{ display: "flex", alignItems: "center", justifyContent: "center" }} href="/admin/finance/tax/guide" prefetch={false} data-testid="guide-link">
          BUKA PANDUAN LAPOR PAJAK
        </Link>
      </Card>

      <Card title="Kesiapan paket" sub="Paket boleh disiapkan sebagai draf, tetapi baru layak dibawa ke akuntan jika semua lulus.">
        {checks.map((c) => <Check key={c.label} ok={c.ok} label={c.label} detail={c.detail} />)}
        <Check ok={bank.final} label="Rekonsiliasi bank disahkan" detail={bank.reconciled ? "Selisih nol, menunggu pengesahan" : "Masih ada selisih belum terjelaskan"} />
        <Check ok={pkp} label="Konfigurasi pajak diverifikasi akuntan" detail="Tarif dan status PKP tidak pernah diasumsikan" />
        <Check ok={fiscal.entity.status === "COMPLETE"} label="Aktivitas PT lain sudah dimasukkan" detail={fiscal.entity.status === "COMPLETE" ? "Tampilan entitas lengkap" : fiscal.entity.reason} />
      </Card>

      <Card title="Rekap omzet bulanan" sub="Basis kas: diterima dikurangi refund. Bukan SPT.">
        {recap.months.length === 0 ? <Empty title="Belum ada omzet" /> : null}
        {recap.months.map((m) => (
          <Row key={m.month} label={monthLabel(m.month)} value={fmt(m.netTurnover)} />
        ))}
        <Row total label={`Omzet bersih ${recap.year}`} value={fmt(recap.yearTurnover)} />
        <p className="fin-note">
          {pkp ? "PPN dihitung hanya dari konfigurasi terverifikasi." : "PPN tidak dihitung: status PKP belum diverifikasi."}
        </p>
      </Card>

      <Card title="Rekonsiliasi fiskal (segmen LINOE)" sub="Bukan SPT seluruh PT Tanyopo. Hanya penyesuaian yang diverifikasi yang dihitung.">
        <Row label="Laba (rugi) komersial segmen" value={fmt(seg.commercialProfit)} />
        <Row label="Koreksi fiskal positif (terverifikasi)" value={fmt(seg.positiveAdjustments)} />
        <Row label="Koreksi fiskal negatif (terverifikasi)" value={fmt(seg.negativeAdjustments)} />
        <Row label="Laba fiskal sebelum kompensasi rugi" value={fmt(seg.fiscalProfitBeforeLoss)} />
        <Row label="Kompensasi kerugian dipakai" value={fmt(seg.lossUsed)} />
        <Row total label="Penghasilan kena pajak (segmen)" value={fmt(seg.taxableIncome)} />
        <div className="fin-row">
          <span>PPh badan (segmen)</span>
          {seg.tax.status === "COMPUTED" ? <span className="n">{fmt(seg.tax.amount)}</span> : <Badge tone="warn">Belum dikonfigurasi</Badge>}
        </div>
        {fiscal.pendingAdjustments.map((a) => (
          <p key={a.id} className="fin-note warn">Belum diverifikasi, tidak dihitung: {a.description} ({fmt(a.amount)})</p>
        ))}
        {fiscal.entity.status === "INCOMPLETE" ? (
          <p className="fin-note warn">{fiscal.entity.reason}</p>
        ) : null}
      </Card>

      <Card title="Pajak dibayar dan bukti potong">
        {taxPayments.length === 0 ? (
          <Empty title="Belum ada data">Dicatat hanya jika ada bukti (nomor bukti potong atau NTPN).</Empty>
        ) : (
          taxPayments.map((t) => <Row key={t.id} label={`${t.kind} · ${t.date} · ${t.evidenceRef}`} value={fmt(t.amount)} />)
        )}
      </Card>

      <Card title="Paket pendukung Coretax" sub="PDF laporan keuangan, Excel, CSV, dan manifest SHA-256 dalam satu ZIP.">
        <form method="post" action="/admin/finance/tax/coretax-package">
          <input type="hidden" name="year" value={recap.year} />
          <button className="fin-btn" type="submit" disabled={!canExport} data-testid="coretax-button">
            SIAPKAN PAKET CORETAX
          </button>
        </form>
        {!canExport ? <p className="fin-note warn">Anda belum memiliki izin menyiapkan paket (izin: ekspor pajak).</p> : null}
        <p className="fin-note">
          Ini bukan berkas impor Coretax dan tidak otomatis dapat diimpor. Tidak ada file XML karena spesifikasi resmi DJP belum
          divalidasi. Aplikasi tidak login, tidak mengirim SPT, dan tidak membayar pajak: semua dilakukan manusia di Coretax.
        </p>
        {demo ? <p className="fin-note">Mode DEMO: paket berisi data fiktif dan berlabel DEMO.</p> : null}
      </Card>
    </Frame>
  );
}
