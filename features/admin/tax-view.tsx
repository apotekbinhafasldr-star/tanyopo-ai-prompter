import { DemoBanner, KeyValueRow, Notice, PageTitle, Section, StatusBadge } from "@/features/admin/ui";
import { formatRupiah, monthLabel } from "@/lib/admin/format";
import type { TaxFigure, TurnoverRecap } from "@/lib/finance";

function figureText(figure: TaxFigure): { text: string; muted: boolean } {
  if (figure.status === "COMPUTED") return { text: formatRupiah(figure.amount), muted: false };
  if (figure.status === "NOT_APPLICABLE") return { text: "Tidak berlaku", muted: true };
  return { text: "Belum dikonfigurasi", muted: true };
}

const CHECKLIST = [
  "Status PKP perusahaan (PKP / bukan PKP) dari akuntan",
  "Tarif PPN yang berlaku dan apakah harga sudah termasuk PPN",
  "Tarif pajak final atas omzet (jika berlaku)",
  "Batas omzet tahunan yang perlu dipantau",
  "Kebijakan pengakuan pendapatan dan refund",
];

/**
 * Tax dashboard body. It reports turnover, never invents a tax rate: every
 * tax cell reads "Belum dikonfigurasi" until the accountant's verified
 * configuration exists.
 */
export function TaxView({ recap, demo }: { recap: TurnoverRecap; demo: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      {demo ? <DemoBanner /> : null}
      <PageTitle title="Pajak" description={`Rekap omzet tahun ${recap.year} (basis kas: diterima dikurangi refund)`} />

      <Section title="Status konfigurasi pajak">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-foreground">Konfigurasi diverifikasi akuntan</p>
          <StatusBadge variant={recap.configVerified ? "success" : "danger"}>
            {recap.configVerified ? "Terverifikasi" : "Belum terverifikasi"}
          </StatusBadge>
        </div>
        {!recap.configVerified ? (
          <div className="mt-3">
            <Notice>
              Tidak ada tarif atau status pajak yang diasumsikan. Angka pajak baru dihitung setelah konfigurasi
              diverifikasi (nama pemverifikasi dan tanggal tercatat).
            </Notice>
          </div>
        ) : null}
      </Section>

      <Section title="Omzet per bulan">
        <ul className="flex flex-col divide-y divide-border">
          {recap.months.map((m) => {
            const ppn = figureText(m.ppn);
            const final = figureText(m.finalTax);
            return (
              <li key={m.month} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{monthLabel(m.month)}</p>
                  <p className="text-sm font-semibold text-foreground">{formatRupiah(m.netTurnover)}</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Diterima {formatRupiah(m.grossReceived)} · refund {formatRupiah(m.refunds)}
                </p>
                <p className="text-xs text-muted-foreground">
                  PPN: <span className={ppn.muted ? "italic" : "font-medium text-foreground"}>{ppn.text}</span> · Pajak
                  final: <span className={final.muted ? "italic" : "font-medium text-foreground"}>{final.text}</span>
                </p>
              </li>
            );
          })}
        </ul>
        <dl className="mt-3 border-t border-border pt-2">
          <KeyValueRow label={`Total omzet ${recap.year}`} value={formatRupiah(recap.yearTurnover)} strong />
          <KeyValueRow
            label="Batas omzet tahunan"
            value={recap.thresholdReached === null ? "Belum diatur" : recap.thresholdReached ? "Sudah tercapai" : "Belum tercapai"}
          />
        </dl>
      </Section>

      <Section title="Yang perlu dikonfirmasi akuntan">
        <ul className="list-disc pl-5 text-sm text-foreground">
          {CHECKLIST.map((item) => (
            <li key={item} className="py-0.5">
              {item}
            </li>
          ))}
        </ul>
      </Section>

      {recap.warnings.length > 0 ? (
        <Section title="Peringatan">
          <ul className="list-disc pl-5 text-sm text-muted-foreground">
            {recap.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
