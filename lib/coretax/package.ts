import { createHash } from "node:crypto";
import type { FiscalReconciliation, TaxPaymentRecord } from "@/lib/accounting/fiscal";
import { taxPaymentRegister } from "@/lib/accounting/fiscal";
import type { Ledger } from "@/lib/accounting/ledger";
import { balanceSheet, cashFlowStatement, incomeStatement, reportWarnings, trialBalance } from "@/lib/accounting/statements";
import { toCsv } from "@/lib/finance/csv";
import type { DateRange } from "@/lib/finance/dates";
import { toDecimalString, type Money } from "@/lib/finance/money";
import type { TurnoverRecap } from "@/lib/finance/tax";
import { buildPdf, type PdfLine } from "./pdf";
import { buildXlsx, type Sheet } from "./xlsx";
import { buildZip } from "./zip";

/**
 * "Paket Coretax": a package of supporting files for the accountant.
 *
 * It is NOT an import file for Coretax, and nothing here logs in, files an SPT or pays tax.
 * No XML attachment is produced: that needs an official DJP specification validated against a
 * DJP validator, which this project does not have. The manifest says so explicitly.
 */
export const XML_STATUS = {
  status: "NOT_AVAILABLE",
  reason: "Tidak ada XML: spesifikasi resmi DJP belum divalidasi. File di paket ini adalah data pendukung untuk akuntan, bukan berkas impor Coretax.",
} as const;

export interface PackageInput {
  readonly ledger: Ledger;
  readonly range: DateRange;
  readonly year: string;
  readonly turnover: TurnoverRecap;
  readonly fiscal: FiscalReconciliation;
  readonly taxPayments: readonly TaxPaymentRecord[];
  readonly generatedAt: string;
  readonly generatedBy: string;
  readonly demo: boolean;
  readonly entityName: string;
}

export interface PackageResult {
  readonly zip: Uint8Array;
  readonly filename: string;
  readonly manifest: Record<string, unknown>;
  readonly files: readonly { name: string; bytes: number; sha256: string }[];
  readonly checks: Record<string, boolean>;
}

const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");
const dec = (m: Money): string => toDecimalString(m);

export function buildCoretaxPackage(input: PackageInput): PackageResult {
  const { ledger, range } = input;
  const enc = new TextEncoder();
  const tb = trialBalance(ledger, range.to);
  const is = incomeStatement(ledger, range);
  const bs = balanceSheet(ledger, range.to);
  const cf = cashFlowStatement(ledger, range);
  const taxReg = taxPaymentRegister(input.taxPayments, ledger.currency);
  const checks = {
    trialBalanceBalanced: tb.balanced,
    balanceSheetBalanced: bs.balanced,
    cashFlowReconciled: cf.reconciled,
    entityLevelComplete: input.fiscal.entity.status === "COMPLETE",
    turnoverTaxConfigVerified: input.turnover.configVerified,
  };
  const banner = `${input.demo ? "DATA DEMO - " : ""}DRAFT - belum final, belum direkonsiliasi/diverifikasi akuntan`;

  // ---- CSV
  const csv = new Map<string, string>();
  csv.set("csv/neraca-saldo.csv", toCsv(["kode", "akun", "debit", "kredit"], tb.rows.map((r) => [r.code, r.name, r.debit, r.credit])));
  csv.set(
    "csv/jurnal-umum.csv",
    toCsv(
      ["id", "tanggal", "tipe", "referensi", "kunci_sumber", "akun", "debit", "kredit", "pembalik_dari", "diposting_oleh"],
      ledger.entries().flatMap((e) => e.lines.map((l) => [e.id, e.date, e.type, e.reference, e.sourceKey, l.account, l.debit, l.credit, e.reversesId, e.postedBy])),
    ),
  );
  csv.set("csv/laba-rugi.csv", toCsv(["bagian", "kode", "akun", "jumlah"], [
    ...is.revenue.map((l) => ["Pendapatan", l.code, l.name, l.amount]),
    ...is.expenses.map((l) => ["Beban", l.code, l.name, l.amount]),
    ["Laba (rugi) bersih", "", "", is.netIncome],
  ]));
  csv.set("csv/neraca.csv", toCsv(["bagian", "kode", "akun", "jumlah"], [
    ...bs.assets.map((l) => ["Aset", l.code, l.name, l.amount]),
    ...bs.liabilities.map((l) => ["Liabilitas", l.code, l.name, l.amount]),
    ...bs.equity.map((l) => ["Ekuitas", l.code, l.name, l.amount]),
    ["Ekuitas", "", "Laba tahun berjalan (belum ditutup)", bs.currentEarnings],
    ["Selisih (harus 0)", "", "", bs.difference],
  ]));
  csv.set("csv/arus-kas.csv", toCsv(["pos", "jumlah"], [
    ["Kas awal", cf.openingCash], ["Operasi", cf.operating], ["Investasi", cf.investing], ["Pendanaan", cf.financing],
    ["Belum terklasifikasi", cf.unclassified], ["Perubahan bersih", cf.netChange], ["Kas akhir", cf.closingCash],
  ]));
  csv.set("csv/rekap-omzet.csv", toCsv(["bulan", "diterima", "refund", "omzet_bersih", "ppn", "pajak_final"], input.turnover.months.map((m) => [
    m.month, m.grossReceived, m.refunds, m.netTurnover,
    m.ppn.status === "COMPUTED" ? m.ppn.amount : m.ppn.status,
    m.finalTax.status === "COMPUTED" ? m.finalTax.amount : m.finalTax.status,
  ])));
  const fv = input.fiscal.segment;
  csv.set("csv/rekonsiliasi-fiskal.csv", toCsv(["lingkup", "uraian", "jumlah", "status"], [
    ["Segmen LINOE", "Laba komersial", fv.commercialProfit, "dihitung"],
    ...input.fiscal.appliedAdjustments.map((a) => ["Segmen LINOE", `${a.direction === "POSITIVE" ? "Koreksi positif" : "Koreksi negatif"} (${a.nature}): ${a.description}`, a.amount, `terverifikasi ${a.verifiedBy}`]),
    ...input.fiscal.pendingAdjustments.map((a) => ["Segmen LINOE", `${a.direction}: ${a.description}`, a.amount, "BELUM TERVERIFIKASI - tidak dihitung"]),
    ["Segmen LINOE", "Laba fiskal sebelum kompensasi rugi", fv.fiscalProfitBeforeLoss, "dihitung"],
    ["Segmen LINOE", "Kompensasi kerugian dipakai", fv.lossUsed, input.fiscal.lossCarryforwardStatus],
    ["Segmen LINOE", "Penghasilan kena pajak (segmen)", fv.taxableIncome, "dihitung"],
    ["Segmen LINOE", "PPh badan (segmen)", fv.tax.status === "COMPUTED" ? fv.tax.amount : fv.tax.reason, fv.tax.status],
    ["Entitas PT", "Status", input.fiscal.entity.status === "COMPLETE" ? "LENGKAP" : input.fiscal.entity.reason, input.fiscal.entity.status],
  ]));
  csv.set("csv/pajak-dibayar-bukti-potong.csv", toCsv(["id", "jenis", "tanggal", "uraian", "jumlah", "bukti"], taxReg.rows.map((r) => [r.id, r.kind, r.date, r.description, r.amount, r.evidenceRef])));

  // ---- XLSX
  const sheets: Sheet[] = [
    { name: "Catatan", header: ["Catatan"], rows: [[banner], ["Lingkup: segmen LINOE, bukan SPT seluruh PT."], [XML_STATUS.reason], ...input.fiscal.warnings.map((w) => [w])] },
    { name: "Neraca Saldo", header: ["Kode", "Akun", "Debit", "Kredit"], rows: tb.rows.map((r) => [r.code, r.name, r.debit, r.credit]) },
    { name: "Jurnal Umum", header: ["ID", "Tanggal", "Tipe", "Referensi", "Kunci sumber", "Akun", "Debit", "Kredit", "Pembalik dari", "Oleh"], rows: ledger.entries().flatMap((e) => e.lines.map((l) => [e.id, e.date, e.type, e.reference, e.sourceKey, l.account, l.debit, l.credit, e.reversesId, e.postedBy])) },
    { name: "Laba Rugi", header: ["Bagian", "Kode", "Akun", "Jumlah"], rows: [...is.revenue.map((l) => ["Pendapatan", l.code, l.name, l.amount]), ...is.expenses.map((l) => ["Beban", l.code, l.name, l.amount]), ["Laba (rugi) bersih", "", "", is.netIncome]] },
    { name: "Neraca", header: ["Bagian", "Kode", "Akun", "Jumlah"], rows: [...bs.assets.map((l) => ["Aset", l.code, l.name, l.amount]), ...bs.liabilities.map((l) => ["Liabilitas", l.code, l.name, l.amount]), ...bs.equity.map((l) => ["Ekuitas", l.code, l.name, l.amount]), ["Ekuitas", "", "Laba tahun berjalan", bs.currentEarnings], ["Selisih", "", "", bs.difference]] },
    { name: "Arus Kas", header: ["Pos", "Jumlah"], rows: [["Kas awal", cf.openingCash], ["Operasi", cf.operating], ["Investasi", cf.investing], ["Pendanaan", cf.financing], ["Belum terklasifikasi", cf.unclassified], ["Kas akhir", cf.closingCash]] },
    { name: "Rekap Omzet", header: ["Bulan", "Diterima", "Refund", "Omzet bersih"], rows: input.turnover.months.map((m) => [m.month, m.grossReceived, m.refunds, m.netTurnover]) },
    { name: "Rekonsiliasi Fiskal", header: ["Uraian", "Jumlah", "Status"], rows: [["Laba komersial (segmen)", fv.commercialProfit, ""], ["Koreksi positif (terverifikasi)", fv.positiveAdjustments, ""], ["Koreksi negatif (terverifikasi)", fv.negativeAdjustments, ""], ["Laba fiskal sebelum kompensasi", fv.fiscalProfitBeforeLoss, ""], ["Kompensasi rugi dipakai", fv.lossUsed, input.fiscal.lossCarryforwardStatus], ["PKP segmen", fv.taxableIncome, ""], ["PPh badan segmen", fv.tax.status === "COMPUTED" ? fv.tax.amount : null, fv.tax.status]] },
    { name: "Pajak Dibayar", header: ["ID", "Jenis", "Tanggal", "Uraian", "Jumlah", "Bukti"], rows: taxReg.rows.map((r) => [r.id, r.kind, r.date, r.description, r.amount, r.evidenceRef]) },
  ];
  const xlsx = buildXlsx(sheets, input.generatedAt);

  // ---- PDF
  const L: PdfLine[] = [];
  const h = (t: string) => L.push({ text: t, bold: true, size: 12 });
  const row = (t: string, a: Money, bold = false) => L.push({ text: t, amount: dec(a), bold });
  L.push({ text: `${input.entityName} - segmen LINOE - ${range.from} s.d. ${range.to}`, size: 9 });
  L.push({ text: " " });
  h("Laporan Laba Rugi");
  is.revenue.forEach((l) => row(`${l.code} ${l.name}`, l.amount));
  row("Total pendapatan", is.totalRevenue, true);
  is.expenses.forEach((l) => row(`${l.code} ${l.name}`, l.amount));
  row("Total beban", is.totalExpenses, true);
  row("Laba (rugi) bersih", is.netIncome, true);
  L.push({ text: " " });
  h(`Laporan Posisi Keuangan per ${range.to}`);
  bs.assets.forEach((l) => row(`${l.code} ${l.name}`, l.amount));
  row("Total aset", bs.totalAssets, true);
  bs.liabilities.forEach((l) => row(`${l.code} ${l.name}`, l.amount));
  row("Total liabilitas", bs.totalLiabilities, true);
  bs.equity.forEach((l) => row(`${l.code} ${l.name}`, l.amount));
  row("Laba tahun berjalan", bs.currentEarnings);
  row("Total ekuitas", bs.totalEquity, true);
  row("Selisih Aset - (Liabilitas + Ekuitas)", bs.difference, true);
  L.push({ text: " " });
  h("Laporan Arus Kas (metode langsung)");
  row("Kas awal", cf.openingCash);
  row("Operasi", cf.operating);
  row("Investasi", cf.investing);
  row("Pendanaan", cf.financing);
  if (cf.unclassified.minor !== BigInt(0)) row("Belum terklasifikasi", cf.unclassified);
  row("Kas akhir", cf.closingCash, true);
  L.push({ text: " " });
  L.push({ text: "Lingkup segmen LINOE saja, bukan SPT seluruh PT. Draf untuk akuntan; tidak otomatis dapat diimpor ke Coretax.", size: 9 });
  const pdf = buildPdf({ title: "Laporan Keuangan (Draf)", banner, footer: `Dibuat ${input.generatedAt}`, lines: L });

  // ---- README
  const readme = [
    "PAKET PENDUKUNG PELAPORAN PAJAK (UNTUK AKUNTAN)",
    banner,
    "",
    "Isi: laporan keuangan (PDF), workbook Excel, CSV pendukung, manifest.json (SHA-256).",
    "PENTING:",
    "- Ini BUKAN berkas impor Coretax dan tidak otomatis dapat diimpor.",
    `- ${XML_STATUS.reason}`,
    "- Tidak ada login, pengiriman SPT, atau pembayaran pajak otomatis. Semua dilakukan manusia di Coretax.",
    "- Lingkup: segmen LINOE. Pajak badan PT Tanyopo harus direkonsiliasi dengan aktivitas PT lainnya oleh akuntan.",
    "- Tarif, status PKP, penyesuaian fiskal: hanya yang diverifikasi yang dihitung. Tidak ada tarif tebakan.",
    ...reportWarnings(ledger, range.to).map((w) => `- ${w}`),
    input.demo ? "- DATA DEMO: seluruh angka fiktif." : "",
    "",
  ].filter((x, i, a) => x !== "" || a[i - 1] !== "").join("\n");

  const bodyFiles: Array<{ name: string; data: Uint8Array }> = [
    { name: "README.txt", data: enc.encode(readme) },
    { name: "laporan-keuangan.pdf", data: pdf },
    { name: "laporan-akuntansi.xlsx", data: xlsx },
    ...[...csv.entries()].map(([name, text]) => ({ name, data: enc.encode(text) })),
  ];
  const files = bodyFiles.map((f) => ({ name: f.name, bytes: f.data.length, sha256: sha256(f.data) }));
  const manifest = {
    generatedAt: input.generatedAt,
    generatedBy: input.generatedBy,
    demo: input.demo,
    scope: "SEGMEN_LINOE (bukan SPT seluruh PT)",
    period: range,
    status: "DRAFT",
    coretaxImport: "TIDAK DIKLAIM — paket pendukung untuk akuntan",
    xml: XML_STATUS,
    autoActions: { login: false, fileSpt: false, payTax: false },
    checks,
    warnings: [...reportWarnings(ledger, range.to), ...input.fiscal.warnings],
    files,
  };
  const manifestBytes = enc.encode(JSON.stringify(manifest, null, 2));
  const zip = buildZip([...bodyFiles, { name: "manifest.json", data: manifestBytes }], input.generatedAt);
  return { zip, filename: `paket-coretax-${input.year}${input.demo ? "-DEMO" : ""}.zip`, manifest, files, checks };
}
