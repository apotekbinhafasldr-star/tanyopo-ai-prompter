import Link from "next/link";
import {
  CORETAX_PORTAL,
  annualFilingDeadline,
  kindSlug,
  sourcesFor,
  stepsFor,
  type Readiness,
  type ReturnKind,
} from "@/lib/tax-guide";
import { Badge, Card, Chip, DemoNotice, Empty, Frame, Hero } from "./parts";
import { TaxSubMenu } from "./tax-optimization";
import { GuideWizard } from "./guide-wizard";


const KINDS: ReadonlyArray<{ kind: ReturnKind; title: string; sub: string }> = [
  { kind: "PPH_BADAN", title: "SPT Tahunan PPh Badan", sub: "Dilaporkan setahun sekali atas nama PT, lengkap dengan laporan keuangan dan rekonsiliasi fiskal." },
  { kind: "PPN", title: "SPT Masa PPN", sub: "Hanya jika PT sudah dikukuhkan sebagai PKP. Jika belum, jenis ini tidak berlaku." },
  { kind: "LAINNYA", title: "Kewajiban pajak masa lainnya", sub: "Tampil hanya jika akuntan sudah memverifikasi kewajibannya." },
];

export interface TaxGuideProps {
  readonly kind: ReturnKind | null;
  readonly year: string;
  readonly years: readonly string[];
  readonly readiness: Readiness | null;
  readonly pkpVerified: boolean;
  readonly otherObligations: readonly string[];
  readonly canExport: boolean;
  readonly canOptimize?: boolean;
  readonly demo: boolean;
  readonly initialStep?: number;
}

export function TaxGuide(p: TaxGuideProps) {
  return (
    <Frame>
      {p.demo ? <DemoNotice /> : null}
      <Hero title="Panduan Lapor Pajak" subtitle="PT Tanyopo Future Technology · Langkah demi langkah di Coretax resmi" />
      <TaxSubMenu current="panduan" canOptimize={p.canOptimize ?? false} />

      <Card>
        <p className="fin-note" data-testid="guide-safety">
          Aplikasi ini hanya memandu. Tidak masuk ke Coretax, tidak meminta atau menyimpan kata sandi, OTP, atau kode otorisasi,
          tidak mengirim SPT, dan tidak membayar pajak. Semua dilakukan Anda sendiri di Coretax. Ini bukan nasihat pajak:
          konfirmasikan ke akuntan atau KPP.
        </p>
      </Card>

      {p.kind === null ? <Chooser year={p.year} otherCount={p.otherObligations.length} /> : null}
      {p.kind === "LAINNYA" ? <Others names={p.otherObligations} /> : null}
      {p.kind === "PPH_BADAN" || p.kind === "PPN" ? <Selected {...p} kind={p.kind} /> : null}
    </Frame>
  );
}

function Chooser({ year, otherCount }: { year: string; otherCount: number }) {
  return (
    <Card title="Pilih jenis pelaporan" sub="Tidak semua jenis SPT wajib dilaporkan PT. Pilih yang berlaku untuk PT Anda.">
      <div className="fin-list">
        {KINDS.map((k) => {
          const disabled = k.kind === "LAINNYA" && otherCount === 0;
          const inner = (
            <>
              <b>{k.title}</b>
              <small style={{ display: "block", color: "var(--mute)", fontSize: 12 }}>{k.sub}</small>
              {disabled ? <Badge tone="warn">Belum ada yang terverifikasi</Badge> : null}
            </>
          );
          return disabled ? (
            <div key={k.kind} className="fin-jr" aria-disabled="true" data-testid={`kind-${kindSlug(k.kind)}`}>{inner}</div>
          ) : (
            <Link key={k.kind} className="fin-jr" prefetch={false} href={`/admin/finance/tax/guide?jenis=${kindSlug(k.kind)}&tahun=${year}`} data-testid={`kind-${kindSlug(k.kind)}`}>
              {inner}
            </Link>
          );
        })}
      </div>
    </Card>
  );
}

function Others({ names }: { names: readonly string[] }) {
  return (
    <Card title="Kewajiban pajak masa lainnya">
      {names.length === 0 ? (
        <Empty title="Belum ada kewajiban lain yang terverifikasi">
          Jangan menganggap semua jenis SPT wajib. Minta akuntan memverifikasi kewajiban PT (mis. PPh masa) sebelum daftar ini terisi.
        </Empty>
      ) : (
        names.map((n) => <p key={n}>{n}</p>)
      )}
      <p><Link className="fin-chip" href="/admin/finance/tax/guide" prefetch={false}>Kembali ke pilihan</Link></p>
    </Card>
  );
}

function Selected(p: TaxGuideProps & { kind: "PPH_BADAN" | "PPN" }) {
  const steps = stepsFor(p.kind);
  const sources = sourcesFor(p.kind);
  const r = p.readiness;
  const title = p.kind === "PPH_BADAN" ? "SPT Tahunan PPh Badan" : "SPT Masa PPN";
  const deadline = p.kind === "PPH_BADAN" ? annualFilingDeadline(p.year) : null;
  return (
    <>
      <Card title={title} sub={p.kind === "PPH_BADAN" ? `Tahun pajak ${p.year}` : `Masa pajak ${p.year}`}>
        <nav className="fin-chips" aria-label="Jenis dan tahun">
          <Chip href="/admin/finance/tax/guide" current={false}>Ganti jenis</Chip>
          {p.years.map((y) => (
            <Chip key={y} href={`/admin/finance/tax/guide?jenis=${kindSlug(p.kind)}&tahun=${y}`} current={y === p.year}>{y}</Chip>
          ))}
        </nav>
        {p.kind === "PPH_BADAN" ? (
          <p className="fin-note" data-testid="deadline">
            Batas lapor (jika tahun pajak = tahun kalender): {deadline}. Menurut DJP, batasnya akhir bulan keempat setelah tahun pajak berakhir; perpanjangan dua bulan tidak memperpanjang pembayaran.
          </p>
        ) : (
          <p className="fin-note" data-testid="ppn-applicability">
            {p.pkpVerified
              ? "Status PKP sudah diverifikasi. PKP wajib lapor tiap bulan, termasuk nihil."
              : "Status PKP belum diverifikasi, jadi PPN tidak diasumsikan berlaku untuk PT. Jangan melapor PPN jika PT bukan PKP."}
          </p>
        )}
      </Card>

      {r ? (
        <section className={`fin-card`} data-testid="readiness" aria-live="polite">
          <h2>
            <Badge tone={r.status === "SIAP_LAPOR" ? "good" : "bad"}>{r.label}</Badge>
          </h2>
          <p className="sub">{r.note}</p>
          {r.blockers.map((b) => (
            <div className="fin-check" key={b.code + b.text}>
              <span className="ic no" aria-hidden>!</span>
              <span>{b.text}</span>
            </div>
          ))}
          <p className="fin-note">Data segmen LINOE bukan laporan seluruh PT. Status ini hanya menilai kelengkapan data, bukan bukti pelaporan.</p>
        </section>
      ) : null}

      <GuideWizard
        kind={p.kind}
        year={p.year}
        steps={steps}
        sources={sources}
        blockers={r?.blockers ?? []}
        canExport={p.canExport}
        demo={p.demo}
        initialStep={p.initialStep}
      />

      <Card title="Sumber panduan resmi DJP" sub="Setiap langkah mengacu ke halaman resmi di bawah. Sistem Coretax bisa berubah, jadi cek ulang sebelum melapor.">
        {sources.map((s) => (
          <div className="fin-check" key={s.id}>
            <span className="ic ok" aria-hidden>{s.id}</span>
            <span>
              <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--blue)", textDecoration: "underline", overflowWrap: "anywhere" }}>{s.title}</a>
              <small>{s.publisher} · {s.pageDate} · dibaca {s.verifiedOn}</small>
              <small>{s.covers}</small>
            </span>
          </div>
        ))}
        <p className="fin-note">
          Jenis SPT yang didukung panduan ini: SPT Tahunan PPh Badan dan SPT Masa PPN. Portal:{" "}
          <a href={CORETAX_PORTAL.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--blue)" }}>{CORETAX_PORTAL.label}</a>.
          Langkah yang berlabel &quot;Belum terverifikasi&quot; tidak dikarang: ikuti petunjuk di layar Coretax atau tanyakan ke KPP atau akuntan.
        </p>
      </Card>
    </>
  );
}
