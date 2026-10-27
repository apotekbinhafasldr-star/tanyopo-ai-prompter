import Link from "next/link";
import { formatRupiah } from "@/lib/admin/format";
import { zero } from "@/lib/finance/money";
import { COMPANY, COMPANY_AS_OF, FOUNDER_SPEND_RECAP } from "@/lib/admin/company-profile";
import { figureView, LAW_VERIFIED_ON, LEGAL_SOURCES, PROVISION_CHECKS, verificationSummary, type FigureView, type OptimizationResult } from "@/lib/tax-opt";
import { MISSING_LABEL } from "@/lib/tax-opt/expenses";
import { Badge, Card, Check, Chip, DemoNotice, Empty, Frame, Hero, Row } from "./parts";

const TONE = { TERVERIFIKASI: "good", SIMULASI: "info", PERLU_VERIFIKASI_AKUNTAN: "warn", BELUM_DAPAT_DIHITUNG: "bad" } as const;
const STATE_TEXT = {
  TERVERIFIKASI: "TERVERIFIKASI",
  SIMULASI: "SIMULASI",
  PERLU_VERIFIKASI_AKUNTAN: "PERLU VERIFIKASI AKUNTAN/KONSULTAN PAJAK",
  BELUM_DAPAT_DIHITUNG: "BELUM DAPAT DIHITUNG",
} as const;

export function TaxSubMenu({ current, canOptimize }: { current: "rekap" | "panduan" | "optimasi"; canOptimize: boolean }) {
  return (
    <div role="group" aria-label="Menu pajak" className="fin-chips" data-testid="tax-submenu">
      <Chip href="/admin/finance/tax" current={current === "rekap"}>Rekap pajak</Chip>
      <Chip href="/admin/finance/tax/guide" current={current === "panduan"}>Panduan lapor</Chip>
      {canOptimize ? <Chip href="/admin/finance/tax/optimization" current={current === "optimasi"}>Optimasi Pajak Legal</Chip> : null}
    </div>
  );
}

function FigureBlock({ label, fig }: { label: string; fig: FigureView }) {
  return (
    <div className="fin-row" data-testid="figure">
      <span>
        {label}
        <br />
        <Badge tone={TONE[fig.state]}>{STATE_TEXT[fig.state]}</Badge>
      </span>
      <span className="n">{fig.text ?? "BELUM DAPAT DIHITUNG"}</span>
    </div>
  );
}

function Notes({ fig }: { fig: FigureView }) {
  return (
    <>
      {fig.reasons.map((r) => <p key={r} className="fin-note warn">{r}</p>)}
      {fig.assumptions.map((a) => <p key={a} className="fin-note">Asumsi: {a}</p>)}
      {fig.sources.length ? <p className="fin-note">Dasar hukum: {fig.sources.map((s) => s.label).join("; ")}</p> : null}
    </>
  );
}

export interface TaxOptimizationProps {
  result: OptimizationResult;
  currency: string;
  paidTotalText: string;
  scenario: "nyata" | "contoh";
  canApprove: boolean;
  demo: boolean;
  /** Fingerprint of what is on screen; the Founder approves THIS calculation under THIS rules version. */
  approval?: { calcHashShort: string; rulesVersion: string };
}

export function TaxOptimization({ result, paidTotalText, scenario, canApprove, demo, approval }: TaxOptimizationProps) {
  const sim = result.simulation;
  const line = (id: string) => figureView((sim.lines.find((l) => l.id === id) as (typeof sim.lines)[number]).figure);
  const savings = figureView(sim.savingsTotal);
  const credits = line("CREDITS");
  const finalFig = line("FINAL");
  const expenses = result.expenses;
  const attention = expenses.findings.filter((f) => f.status !== "TERVERIFIKASI_DAPAT_DIKURANGKAN" && f.status !== "TERVERIFIKASI_TIDAK_DAPAT_DIKURANGKAN" && f.status !== "DIBATALKAN");

  return (
    <Frame>
      {demo ? <DemoNotice /> : null}
      <Hero title="Optimasi Pajak Legal" subtitle="Memastikan tidak membayar lebih dari kewajiban sah · Seluruh PT Tanyopo · Bukan SPT" />
      <TaxSubMenu current="optimasi" canOptimize />

      {scenario === "contoh" ? (
        <div className="fin-demo" role="note" data-testid="scenario-banner">
          <b>CONTOH</b>
          <span>Skenario fiktif dengan data lengkap, hanya untuk memperlihatkan bentuk hasil. Bukan data PT.</span>
        </div>
      ) : (
        <Card>
          <Link className="fin-note" href="/admin/finance/tax/optimization?skenario=contoh" prefetch={false} data-testid="scenario-link">Lihat skenario contoh fiktif dengan data lengkap</Link>
        </Card>
      )}

      {scenario === "nyata" ? (
        <Card title="Profil perusahaan" sub="Sesuai keterangan Founder. Semuanya menunggu verifikasi dokumen; belum ada yang terverifikasi.">
          <div data-testid="company-profile">
            <Row label="Nama" value={COMPANY.name} />
            <Row label="Bentuk" value="PT Perorangan" />
            <Row label="Tahun pendirian" value={COMPANY.foundedYear} />
            <Row label="Tanggal terdaftar NPWP" value="17 September 2026" />
            <p className="fin-note">Tanggal NPWP bukan tanggal pendirian. Tanggal akta belum diketahui dan tidak ditebak.</p>
            <Row label="Status PKP" value="Non-PKP" />
            <Row label={`Peredaran bruto sampai ${COMPANY_AS_OF}`} value={formatRupiah(zero("IDR"))} />
            <Badge tone="warn">MENUNGGU VERIFIKASI DOKUMEN</Badge>
            <div className="fin-row" data-testid="founder-spend"><span>Pengeluaran Founder yang teridentifikasi<br /><small>Rekap awal, bukan angka final. Belum diklasifikasikan: bisa berupa setoran modal, pinjaman pemegang saham, biaya pra-operasi, atau pengeluaran pribadi. Tidak otomatis biaya fiskal dan tidak ada jurnal otomatis.</small></span><span className="n">{formatRupiah(FOUNDER_SPEND_RECAP)}</span></div>
            <p className="fin-note"><b>Dokumen yang dibutuhkan:</b></p>
            {COMPANY.documentsNeeded.map((d) => <p key={d} className="fin-note">- {d}</p>)}
          </div>
        </Card>
      ) : null}

      <Card title="Ringkasan" sub="Status angka: terverifikasi, simulasi, perlu verifikasi akuntan, atau belum dapat dihitung. Satu angka hanya sekuat bahan terlemahnya.">
        <FigureBlock label="Estimasi kewajiban pajak (kurang/lebih bayar)" fig={finalFig} />
        <div className="fin-row"><span>Pajak yang telah dibayar (bukti terverifikasi)<br /><Badge tone="info">DARI CATATAN BERBUKTI</Badge></span><span className="n">{paidTotalText}</span></div>
        <FigureBlock label="Kredit pajak terverifikasi" fig={credits} />
        <FigureBlock label="Potensi penghematan legal (fasilitas)" fig={savings} />
        <div className="fin-row"><span>Biaya yang perlu diperiksa<br /><Badge tone={attention.length ? "warn" : "good"}>{attention.length} BIAYA</Badge></span><span className="n">{formatRupiah(expenses.needsAttention)}</span></div>
        <p className="fin-note">{sim.disclaimer}</p>
      </Card>

      <Card title="Simulasi bertahap" sub="Dari pajak sebelum penyesuaian sampai estimasi akhir. Pembukuan asli tidak diubah.">
        {sim.lines.map((l) => {
          const fv = figureView(l.figure);
          return (
            <div key={l.id} data-testid={`sim-${l.id}`}>
              <FigureBlock label={l.label} fig={fv} />
              <Notes fig={fv} />
            </div>
          );
        })}
      </Card>

      <Card title="Fasilitas dan skema yang mungkin tersedia" sub="Mesin tidak memilih skema. Pilihan dan persetujuan ada pada Founder bersama akuntan.">
        {result.schemes.results.map((r) => (
          <div key={r.id} data-testid={`scheme-${r.id}`}>
            <div className="fin-row"><span>{r.name}</span><Badge tone={r.eligibility === "MEMENUHI_SYARAT" ? "good" : r.eligibility === "TIDAK_MEMENUHI" ? "bad" : "warn"}>{r.eligibility.replaceAll("_", " ")}</Badge></div>
            {r.reasons.map((x) => <p key={x} className="fin-note">{x}</p>)}
          </div>
        ))}
        {result.schemes.conflicts.map((c) => <p key={c} className="fin-note warn">{c}</p>)}
        <p className="fin-note">{result.schemes.note}</p>
      </Card>

      <Card title="Biaya yang perlu diperiksa" sub="Tidak semua pengeluaran otomatis dapat dikurangkan. Tiap biaya butuh bukti, kaitan usaha, akun, perlakuan fiskal, dan verifikasi.">
        {expenses.findings.length === 0 ? <Empty title="Belum ada biaya" /> : null}
        {expenses.findings.map((f) => (
          <div key={f.expenseId} data-testid="expense-row">
            <div className="fin-row"><span>{f.category} · {f.vendor}<br /><small>{f.status.replaceAll("_", " ")}</small></span><span className="n">{formatRupiah(f.amount)}</span></div>
            {f.missing.length ? <p className="fin-note warn">Belum ada: {f.missing.map((m) => MISSING_LABEL[m]).join(", ")}</p> : null}
            <p className="fin-note">{f.hint}</p>
          </div>
        ))}
        <Row label="Dapat dikurangkan (terverifikasi)" value={formatRupiah(expenses.deductibleVerified)} />
        <Row label="Tidak dapat dikurangkan (koreksi fiskal positif)" value={formatRupiah(expenses.nonDeductibleVerified)} />
        <p className="fin-note">Koreksi dicatat sebagai penyesuaian fiskal terpisah dan dapat ditelusuri. Data akuntansi tidak diubah.</p>
      </Card>

      <Card title="Kredit pajak dan pembayaran">
        {result.credits.findings.length === 0 ? <Empty title="Belum ada catatan">Dicatat hanya jika ada bukti potong atau NTPN.</Empty> : null}
        {result.credits.findings.map((f) => (
          <div key={f.id}>
            <div className="fin-row"><span>{f.kind} · {f.id}<br /><small>{f.status.replaceAll("_", " ")}</small></span><span className="n">{formatRupiah(f.amount)}</span></div>
            <p className="fin-note">{f.note}</p>
          </div>
        ))}
      </Card>

      <Card title="PPN">
        {result.ppn.active ? (
          <>
            <Row label="Pajak keluaran" value={formatRupiah(result.ppn.outputTax)} />
            <Row label="Pajak masukan yang dapat dikreditkan" value={formatRupiah(result.ppn.creditableInputTax)} />
            <FigureBlock label="PPN kurang/lebih bayar" fig={figureView(result.ppn.net)} />
          </>
        ) : (
          <Empty title="PPN tidak aktif">{result.ppn.reason}</Empty>
        )}
        <p className="fin-note">Faktur pajak tidak pernah dibuat atau dilengkapi oleh aplikasi.</p>
      </Card>

      <Card title="Verifikasi tagihan pajak" sub="Pemeriksaan ini tidak menyimpulkan surat benar atau salah. Hanya membandingkan angka dan menunjukkan jalur resmi.">
        {result.notices.length === 0 ? <Empty title="Tidak ada surat" /> : null}
        {result.notices.map((c) => (
          <div key={c.noticeId} data-testid="notice">
            <Row label={`Surat ${c.noticeId}: selisih perhitungan`} value={figureView(c.difference).text ?? "BELUM DAPAT DIHITUNG"} />
            <Row label="Sudah dibayar" value={formatRupiah(c.paid)} />
            <Row label="Masih terutang menurut surat" value={formatRupiah(c.outstanding)} />
            {c.missingDocuments.map((d) => <p key={d} className="fin-note warn">Dokumen belum ada: {d}</p>)}
            {c.paths.map((p) => (
              <p key={p.id} className="fin-note"><b>{p.name}</b> · {p.applicability.replaceAll("_", " ")} · {p.deadline ? `batas ${p.deadline}` : p.deadlineNote}</p>
            ))}
          </div>
        ))}
      </Card>

      <Card title="Temuan risiko dan kekurangan dokumen">
        {result.findings.length === 0 ? <Empty title="Tidak ada temuan" /> : null}
        {result.findings.map((f, i) => <Check key={`${i}-${f.text}`} ok={f.level === "info"} label={f.text} />)}
      </Card>

      <Card title="Persetujuan Founder" sub="Catatan internal permanen. Bukan verifikasi akuntan dan tidak membuat angka menjadi terverifikasi.">
        <div data-testid="approval-card">
          <Check ok={false} label={demo ? "Tidak dapat disimpan: data masih DEMO" : "Menunggu keputusan"} />
          <Row label="Yang berhak memutuskan" value={canApprove ? "akun ini berhak menyetujui" : "akun ini tidak berhak menyetujui"} />
          {approval ? <Row label="Sidik perhitungan" value={approval.calcHashShort} /> : null}
          {approval ? <Row label="Versi aturan" value={approval.rulesVersion} /> : null}
          <p className="fin-note">Keputusan tersimpan append-only dan tidak dapat diubah. Koreksi atau pencabutan dicatat sebagai peristiwa baru. Jika perhitungan atau versi aturan berubah, persetujuan lama otomatis tidak berlaku sampai ditinjau ulang. Persetujuan hanya untuk angka TERVERIFIKASI tanpa butir terbuka.</p>
        </div>
      </Card>

      <Card title="Status verifikasi dasar hukum" sub={`Diperiksa ${LAW_VERIFIED_ON}. Pasal tanpa naskah primer tidak dianggap terverifikasi.`}>
        <p className="fin-note" data-testid="provision-summary">{(() => { const v = verificationSummary(); return `Primer ${v.primary} · Sebagian ${v.partial} · Hanya DJP ${v.secondary} · Historis/dihapus ${v.historical} · BLOCKED ${v.blocked}`; })()}</p>
        {PROVISION_CHECKS.map((p) => (
          <div key={p.id} data-testid={`provision-${p.id}`}>
            <div className="fin-row"><span>{p.provision}</span><Badge tone={p.status === "TERVERIFIKASI_PRIMER" ? "good" : p.status === "BLOCKED" ? "bad" : "warn"}>{p.status.replaceAll("_", " ")}</Badge></div>
            <p className="fin-note">{p.note}</p>
            {p.needed ? <p className="fin-note warn">Dokumen yang dibutuhkan: {p.needed}</p> : null}
          </div>
        ))}
      </Card>

      <Card title="Status kesiapan pelaporan" sub="Hasil optimasi baru boleh dibawa ke Coretax jika semua butir selesai.">
        <Check ok={result.readyToUse} label={result.readyToUse ? "Siap dibawa ke akuntan" : "BELUM SIAP"} />
        {result.openItems.map((o) => <Check key={o} ok={false} label={o} />)}
        <p className="fin-note">Tidak ada pengiriman SPT atau pembayaran otomatis.</p>
        <Link className="fin-btn" style={{ display: "flex", alignItems: "center", justifyContent: "center" }} href="/admin/finance/tax/guide" prefetch={false}>BUKA PANDUAN LAPOR PAJAK</Link>
      </Card>

      <Card title="Dasar hukum" sub={`Diverifikasi dari halaman resmi DJP pada ${LAW_VERIFIED_ON}. Teks peraturan primer belum dibaca langsung: konfirmasi akuntan.`}>
        {LEGAL_SOURCES.map((s) => (
          <details key={s.id} data-testid="legal-source">
            <summary>{s.id} · {s.regulation} · {s.articles.join(", ")}</summary>
            <p className="fin-note">{s.subject}</p>
            <p className="fin-note">Masa berlaku: {s.effective}</p>
            <p className="fin-note">Persyaratan: {s.requirements.join("; ")}</p>
            <p className="fin-note">Sumber: {s.url} · diverifikasi {s.verifiedOn}{s.caveat ? ` · Catatan: ${s.caveat}` : ""}</p>
          </details>
        ))}
      </Card>
    </Frame>
  );
}
