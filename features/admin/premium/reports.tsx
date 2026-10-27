import {
  balanceSheet,
  cashFlowStatement,
  generalLedger,
  incomeStatement,
  reportWarnings,
  trialBalance,
  type BankReconciliation,
  type Ledger,
  type OpenItemBook,
} from "@/lib/accounting";
import { reconcileControl } from "@/lib/accounting";
import { formatRupiah } from "@/lib/admin/format";
import { REPORT_TABS, REPORT_TAB_LABEL, type ReportTab } from "@/lib/admin/filters";
import type { DateRange } from "@/lib/finance/dates";
import { Badge, Card, Check, Chip, DemoNotice, Empty, Frame, Hero, Row } from "./parts";

const href = (tab: ReportTab, extra = "") => `/admin/finance/reports?r=${tab}${extra}`;

export function ReportsView(props: {
  tab: ReportTab;
  ledger: Ledger;
  range: DateRange;
  account: string;
  bank: BankReconciliation;
  openItems: OpenItemBook;
  demo: boolean;
}) {
  const { tab, ledger, range, demo } = props;
  const warnings = reportWarnings(ledger, range.to);
  const empty = ledger.entries().length === 0;
  return (
    <Frame>
      {demo ? <DemoNotice /> : null}
      <Hero title="Laporan akuntansi" subtitle={`${range.from} s.d. ${range.to} · Draf, belum final`} />
      <nav aria-label="Jenis laporan" className="fin-chips">
        {REPORT_TABS.map((t) => (
          <Chip key={t} href={href(t)} current={t === tab}>
            {REPORT_TAB_LABEL[t]}
          </Chip>
        ))}
      </nav>
      {empty ? (
        <Empty title="Belum ada jurnal">Laporan terisi setelah transaksi terverifikasi dijurnalkan. Tidak ada saldo awal yang dikarang.</Empty>
      ) : (
        <Body {...props} />
      )}
      {warnings.map((w) => (
        <p className="fin-note warn" key={w}>{w}</p>
      ))}
    </Frame>
  );
}

function Body({ tab, ledger, range, account, bank, openItems }: Parameters<typeof ReportsView>[0]) {
  const cur = ledger.currency;
  const fmt = formatRupiah;
  if (tab === "laba-rugi") {
    const is = incomeStatement(ledger, range);
    return (
      <Card title="Laporan laba rugi" sub={`${range.from} s.d. ${range.to}`}>
        <p className="fin-label">Pendapatan</p>
        {is.revenue.map((l) => <Row key={l.code} label={`${l.code} ${l.name}`} value={fmt(l.amount)} />)}
        <Row total label="Total pendapatan" value={fmt(is.totalRevenue)} />
        <p className="fin-label">Beban</p>
        {is.expenses.map((l) => <Row key={l.code} label={`${l.code} ${l.name}`} value={fmt(l.amount)} />)}
        <Row total label="Total beban" value={fmt(is.totalExpenses)} />
        <Row total label="Laba (rugi) bersih" value={fmt(is.netIncome)} />
      </Card>
    );
  }
  if (tab === "neraca") {
    const bs = balanceSheet(ledger, range.to);
    return (
      <>
        <Card title="Laporan posisi keuangan" sub={`per ${range.to}`}>
          <p className="fin-label">Aset</p>
          {bs.assets.map((l) => <Row key={l.code} label={`${l.code} ${l.name}`} value={fmt(l.amount)} />)}
          <Row total label="Total aset" value={fmt(bs.totalAssets)} />
          <p className="fin-label">Liabilitas</p>
          {bs.liabilities.map((l) => <Row key={l.code} label={`${l.code} ${l.name}`} value={fmt(l.amount)} />)}
          <Row total label="Total liabilitas" value={fmt(bs.totalLiabilities)} />
          <p className="fin-label">Ekuitas</p>
          {bs.equity.map((l) => <Row key={l.code} label={`${l.code} ${l.name}`} value={fmt(l.amount)} />)}
          <Row label="Laba tahun berjalan (belum ditutup)" value={fmt(bs.currentEarnings)} />
          <Row total label="Total ekuitas" value={fmt(bs.totalEquity)} />
        </Card>
        <Card>
          <Check ok={bs.balanced} label="Aset = Liabilitas + Ekuitas" detail={`Selisih ${fmt(bs.difference)}`} />
        </Card>
      </>
    );
  }
  if (tab === "arus-kas") {
    const cf = cashFlowStatement(ledger, range);
    return (
      <>
        <Card title="Laporan arus kas" sub="Metode langsung, dikelompokkan menurut akun lawan">
          <Row label="Kas awal" value={fmt(cf.openingCash)} />
          <Row label="Aktivitas operasi" value={fmt(cf.operating)} />
          <Row label="Aktivitas investasi" value={fmt(cf.investing)} />
          <Row label="Aktivitas pendanaan" value={fmt(cf.financing)} />
          {cf.unclassified.minor !== BigInt(0) ? <Row label="Belum terklasifikasi" value={fmt(cf.unclassified)} /> : null}
          <Row total label="Kas akhir" value={fmt(cf.closingCash)} />
        </Card>
        <Card><Check ok={cf.reconciled} label="Kas awal + perubahan = saldo kas buku besar" /></Card>
      </>
    );
  }
  if (tab === "neraca-saldo") {
    const tb = trialBalance(ledger, range.to);
    return (
      <Card title="Neraca saldo" sub={`per ${range.to}`}>
        {tb.rows.map((r) => (
          <div className="fin-row" key={r.code}>
            <span>{r.code} {r.name}</span>
            <span className="n">{r.debit.minor !== BigInt(0) ? `D ${fmt(r.debit)}` : `K ${fmt(r.credit)}`}</span>
          </div>
        ))}
        <Row total label="Total debit" value={fmt(tb.totalDebit)} />
        <Row total label="Total kredit" value={fmt(tb.totalCredit)} />
        <Check ok={tb.balanced} label="Debit = Kredit" />
      </Card>
    );
  }
  if (tab === "buku-besar") {
    const gl = generalLedger(ledger, account, range);
    const options = ledger.chart.list().filter((a) => a.postable && ledger.totals().has(a.code));
    return (
      <>
        <nav aria-label="Pilih akun" className="fin-chips">
          {options.map((a) => (
            <Chip key={a.code} href={href("buku-besar", `&a=${a.code}`)} current={a.code === account}>{a.code}</Chip>
          ))}
        </nav>
        <Card title={`${gl.code} ${gl.name}`} sub="Saldo berjalan menurut sisi normal akun">
          <Row label="Saldo awal periode" value={fmt(gl.openingBalance)} />
          {gl.rows.length === 0 ? <Empty title="Tidak ada mutasi pada periode ini" /> : null}
          {gl.rows.map((r) => (
            <div className="fin-jr" key={`${r.entryId}-${r.debit.minor}-${r.credit.minor}`}>
              <div className="hd"><span>{r.date} · {r.entryId}</span><span>{r.reference}</span></div>
              <div className="tt">{r.description}</div>
              <div className="ln"><span>{r.debit.minor !== BigInt(0) ? "Debit" : "Kredit"}</span><span>{fmt(r.debit.minor !== BigInt(0) ? r.debit : r.credit)}</span><span><b>{fmt(r.balance)}</b></span></div>
            </div>
          ))}
          <Row total label="Saldo akhir" value={fmt(gl.closingBalance)} />
        </Card>
      </>
    );
  }
  if (tab === "jurnal") {
    const entries = ledger.entries().filter((e) => e.date >= range.from && e.date <= range.to).slice(-40).reverse();
    return (
      <Card title="Jurnal umum" sub={`${entries.length} jurnal terbaru dalam periode. Jurnal terposting tidak bisa diubah; koreksi lewat jurnal pembalik.`}>
        {entries.length === 0 ? <Empty title="Tidak ada jurnal pada periode ini" /> : null}
        {entries.map((e) => (
          <div className="fin-jr" key={e.id}>
            <div className="hd"><span>{e.id} · {e.date}</span><span>{e.type === "REVERSAL" ? <Badge tone="warn">Pembalik {e.reversesId}</Badge> : e.type === "NORMAL" ? "Biasa" : e.type}</span></div>
            <div className="tt">{e.description}</div>
            <div className="hd"><span>Ref: {e.reference}</span><span>Oleh: {e.postedBy}</span></div>
            {e.lines.map((l, i) => (
              <div className="ln" key={i}>
                <span>{l.account} {ledger.chart.get(l.account)?.name}</span>
                <span>{l.debit.minor !== BigInt(0) ? fmt(l.debit) : ""}</span>
                <span>{l.credit.minor !== BigInt(0) ? fmt(l.credit) : ""}</span>
              </div>
            ))}
          </div>
        ))}
      </Card>
    );
  }
  if (tab === "piutang-utang") {
    const asOf = range.to;
    const ar = openItems.aging("RECEIVABLE", asOf);
    const ap = openItems.aging("PAYABLE", asOf);
    const rc = reconcileControl(ledger, openItems, "RECEIVABLE", asOf);
    const pc = reconcileControl(ledger, openItems, "PAYABLE", asOf);
    return (
      <>
        <Card title="Umur piutang" sub="Per tanggal laporan">
          {ar.rows.length === 0 ? <Empty title="Belum ada piutang">Langganan LINOE dibayar di muka, jadi piutang biasanya kosong.</Empty> : null}
          {(Object.keys(ar.buckets) as Array<keyof typeof ar.buckets>).map((b) => <Row key={b} label={BUCKET[b]} value={fmt(ar.buckets[b])} />)}
          <Row total label="Total piutang" value={fmt(ar.total)} />
          <Check ok={rc.reconciled} label="Sub-buku cocok dengan akun 1210" detail={`Selisih ${fmt(rc.difference)}`} />
        </Card>
        <Card title="Umur utang" sub="Per tanggal laporan">
          {ap.rows.length === 0 ? <Empty title="Belum ada utang usaha" /> : null}
          {(Object.keys(ap.buckets) as Array<keyof typeof ap.buckets>).map((b) => <Row key={b} label={BUCKET[b]} value={fmt(ap.buckets[b])} />)}
          <Row total label="Total utang" value={fmt(ap.total)} />
          <Check ok={pc.reconciled} label="Sub-buku cocok dengan akun 2110" detail={`Selisih ${fmt(pc.difference)}`} />
        </Card>
      </>
    );
  }
  // bank
  return (
    <>
      <Card title="Rekonsiliasi bank" sub={`per ${bank.asOf}`}>
        <Row label="Saldo menurut rekening koran" value={fmt(bank.statementBalance)} />
        <Row label="Saldo kas menurut buku besar" value={fmt(bank.glBalance)} />
        <Row label="Transaksi cocok" value={`${bank.matches.length}`} />
        <Row total label="Selisih belum terjelaskan" value={fmt(bank.unexplainedDifference)} />
        <Check ok={bank.reconciled} label="Semua selisih terjelaskan" />
        <Check ok={bank.final} label="Rekonsiliasi disahkan manusia" detail={bank.final ? "Final" : "Belum final: perlu pengesahan setelah selisih nol"} />
      </Card>
      <Card title="Ada di bank, belum di buku" sub="Perlu dicatat atau diselidiki">
        {bank.unmatchedBank.length === 0 ? <Empty title="Tidak ada" /> : null}
        {bank.unmatchedBank.map((l) => <Row key={l.id} label={`${l.date} · ${l.reference}`} value={fmt(l.amount)} />)}
      </Card>
      <Card title="Ada di buku, belum di bank">
        {bank.unmatchedGl.length === 0 ? <Empty title="Tidak ada" /> : null}
        {bank.unmatchedGl.map((l) => <Row key={`${l.entryId}-${l.date}`} label={`${l.date} · ${l.reference}`} value={fmt(l.amount)} />)}
      </Card>
    </>
  );
}

const BUCKET = { CURRENT: "Belum jatuh tempo", D1_30: "1–30 hari", D31_60: "31–60 hari", D61_90: "61–90 hari", OVER_90: "Lebih dari 90 hari" } as const;
