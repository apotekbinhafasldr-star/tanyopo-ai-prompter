import { describe, expect, it } from "vitest";
import { UNVERIFIED_TAX_CONFIG, turnoverRecap } from "@/lib/finance";
import {
  Ledger,
  defaultChart,
  journalizeSnapshot,
  incomeStatement,
  reconcileFiscal,
  taxPaymentRegister,
  type FiscalAdjustment,
} from "@/lib/accounting";
import { buildCoretaxPackage } from "@/lib/coretax/package";
import { buildZip, crc32 } from "@/lib/coretax/zip";
import { buildXlsx } from "@/lib/coretax/xlsx";
import { buildPdf } from "@/lib/coretax/pdf";
import { d, expense, fee, idr, newBook, payment, settlement } from "../finance/helpers";

const V = { verifiedBy: "akuntan", verifiedAt: "2026-12-01T00:00:00Z" };
const NV = { verifiedBy: null, verifiedAt: null };
const adj = (id: string, direction: "POSITIVE" | "NEGATIVE", amount: string, v = V): FiscalAdjustment => ({
  id, description: `adj ${id}`, direction, nature: "PERMANENT", amount: idr(amount), evidenceRef: null, ...v,
});
const cfgOk = { rateBps: 2200, ...V };

describe("fiscal reconciliation", () => {
  it("no verified rate: tax is NOT_CONFIGURED, never a guessed number", () => {
    const r = reconcileFiscal({ year: "2026", commercialProfit: idr("1000000"), adjustments: [], lossCarryforward: null, config: { rateBps: null, ...NV } });
    expect(r.segment.tax.status).toBe("NOT_CONFIGURED");
    expect(d(r.segment.taxableIncome)).toBe("1000000.00");
    const unverifiedRate = reconcileFiscal({ year: "2026", commercialProfit: idr("1000000"), adjustments: [], lossCarryforward: null, config: { rateBps: 2200, ...NV } });
    expect(unverifiedRate.segment.tax.status).toBe("NOT_CONFIGURED");
  });

  it("only verified adjustments count; unverified are listed as pending", () => {
    const r = reconcileFiscal({
      year: "2026", commercialProfit: idr("1000000"),
      adjustments: [adj("a", "POSITIVE", "200000"), adj("b", "NEGATIVE", "50000"), adj("c", "POSITIVE", "999999", NV)],
      lossCarryforward: null, config: cfgOk,
    });
    expect(d(r.segment.fiscalProfitBeforeLoss)).toBe("1150000.00");
    expect(r.pendingAdjustments).toHaveLength(1);
    expect(r.warnings.some((w) => w.includes("belum diverifikasi"))).toBe(true);
    expect(r.segment.tax.status === "COMPUTED" && d(r.segment.tax.amount)).toBe("253000.00");
  });

  it("verified loss carry-forward offsets only up to fiscal profit; unverified is ignored", () => {
    const base = { year: "2026", commercialProfit: idr("100000"), adjustments: [], config: cfgOk };
    const used = reconcileFiscal({ ...base, lossCarryforward: { amount: idr("300000"), note: null, ...V } });
    expect(d(used.segment.lossUsed)).toBe("100000.00");
    expect(d(used.segment.lossRemaining)).toBe("200000.00");
    expect(d(used.segment.taxableIncome)).toBe("0.00");
    const pending = reconcileFiscal({ ...base, lossCarryforward: { amount: idr("300000"), note: null, ...NV } });
    expect(pending.lossCarryforwardStatus).toBe("PENDING");
    expect(d(pending.segment.taxableIncome)).toBe("100000.00");
  });

  it("a loss year has zero taxable income", () => {
    const r = reconcileFiscal({ year: "2026", commercialProfit: idr("-500000"), adjustments: [], lossCarryforward: null, config: cfgOk });
    expect(d(r.segment.taxableIncome)).toBe("0.00");
    expect(r.segment.tax.status === "COMPUTED" && d(r.segment.tax.amount)).toBe("0.00");
  });

  it("segment is never the whole PT: entity view stays INCOMPLETE until other activities are verified", () => {
    const base = { year: "2026", commercialProfit: idr("1000000"), adjustments: [], lossCarryforward: null, config: cfgOk };
    expect(reconcileFiscal(base).entity.status).toBe("INCOMPLETE");
    expect(reconcileFiscal(base).segment.scope).toBe("SEGMEN_LINOE");
    expect(reconcileFiscal({ ...base, otherActivities: [{ name: "Apotek", fiscalProfit: idr("500000"), ...NV }] }).entity.status).toBe("INCOMPLETE");
    const full = reconcileFiscal({ ...base, otherActivities: [{ name: "Apotek", fiscalProfit: idr("-200000"), ...V }] });
    expect(full.entity.status).toBe("COMPLETE");
    if (full.entity.status === "COMPLETE") {
      expect(full.entity.view.scope).toBe("ENTITAS_PT");
      expect(d(full.entity.view.fiscalProfitBeforeLoss)).toBe("800000.00");
      expect(full.entity.activities).toEqual(["LINOE", "Apotek"]);
    }
    expect(full.warnings.some((w) => w.includes("segmen LINOE"))).toBe(true);
  });

  it("tax payments/withholding slips need evidence and cannot repeat", () => {
    const rec = (id: string, ev: string) => ({ id, kind: "PPH23" as const, date: "2026-11-10", description: "x", amount: idr("1000"), evidenceRef: ev });
    expect(() => taxPaymentRegister([rec("1", " ")], "IDR")).toThrow();
    expect(() => taxPaymentRegister([rec("1", "BP-1"), rec("1", "BP-2")], "IDR")).toThrow();
    const reg = taxPaymentRegister([rec("1", "BP-1"), rec("2", "BP-2")], "IDR");
    expect(d(reg.total)).toBe("2000.00");
    expect(taxPaymentRegister([], "IDR").provided).toBe(false);
  });
});

function buildInput(over: { demo?: boolean } = {}) {
  const book = newBook();
  book.ingestPayment(payment("p1"));
  book.ingestGatewayFee(fee("p1", "4000"));
  book.ingestSettlement(settlement("s1", "2026-11-04T03:00:00Z", [{ paymentId: "p1", gross: "300000", fee: "4000" }]));
  book.ingestExpense(expense("e1", "2026-11-10", "100000", { vendor: "=cmd|' /C calc'!A0", category: "hosting" }));
  const snap = book.snapshot();
  const ledger = new Ledger(defaultChart(), "IDR");
  journalizeSnapshot(ledger, snap, { actor: "system", at: "2026-12-01T00:00:00Z", through: "2026-11-30" });
  const range = { from: "2026-11-01", to: "2026-11-30" };
  const is = incomeStatement(ledger, range);
  return {
    ledger, range, year: "2026",
    turnover: turnoverRecap(snap, "2026", UNVERIFIED_TAX_CONFIG),
    fiscal: reconcileFiscal({ year: "2026", commercialProfit: is.netIncome, adjustments: [], lossCarryforward: null, config: { rateBps: null, ...NV } }),
    taxPayments: [], generatedAt: "2026-12-01T00:00:00Z", generatedBy: "founder", demo: over.demo ?? true, entityName: "PT Tanyopo Future Technology",
  };
}

function unzipNames(zip: Uint8Array): string[] {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const count = dv.getUint16(zip.length - 22 + 10, true);
  let p = dv.getUint32(zip.length - 22 + 16, true);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const n = dv.getUint16(p + 28, true), extra = dv.getUint16(p + 30, true), cm = dv.getUint16(p + 32, true);
    names.push(new TextDecoder().decode(zip.subarray(p + 46, p + 46 + n)));
    p += 46 + n + extra + cm;
  }
  return names;
}

describe("Coretax support package", () => {
  it("contains PDF, XLSX, CSV, README and a manifest with hashes — and NO xml file", () => {
    const r = buildCoretaxPackage(buildInput());
    const names = unzipNames(r.zip);
    expect(names).toContain("laporan-keuangan.pdf");
    expect(names).toContain("laporan-akuntansi.xlsx");
    expect(names).toContain("manifest.json");
    expect(names).toContain("README.txt");
    expect(names.some((n) => n.startsWith("csv/"))).toBe(true);
    expect(names.some((n) => n.toLowerCase().endsWith(".xml"))).toBe(false);
    expect(r.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);
    expect((r.manifest.xml as { status: string }).status).toBe("NOT_AVAILABLE");
    expect(r.manifest.autoActions).toEqual({ login: false, fileSpt: false, payTax: false });
  });

  it("never claims auto-import and always says segment + draft + demo", () => {
    const r = buildCoretaxPackage(buildInput());
    const text = JSON.stringify(r.manifest);
    expect(text).toContain("TIDAK DIKLAIM");
    expect(text).toContain("SEGMEN_LINOE");
    expect(r.manifest.demo).toBe(true);
    expect(r.filename).toContain("DEMO");
    expect(/otomatis (dapat )?diimpor|auto-?import/i.test(text) && !/tidak otomatis|TIDAK DIKLAIM/i.test(text)).toBe(false);
    expect(buildCoretaxPackage(buildInput({ demo: false })).filename).not.toContain("DEMO");
  });

  it("is deterministic for the same input and reports verification checks", () => {
    const a = buildCoretaxPackage(buildInput());
    const b = buildCoretaxPackage(buildInput());
    expect(Buffer.from(a.zip).equals(Buffer.from(b.zip))).toBe(true);
    expect(a.checks.trialBalanceBalanced).toBe(true);
    expect(a.checks.balanceSheetBalanced).toBe(true);
    expect(a.checks.entityLevelComplete).toBe(false);
    expect(a.checks.turnoverTaxConfigVerified).toBe(false);
  });
});

describe("file writers", () => {
  it("crc32 matches the known check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  it("zip rejects path traversal and duplicate names", () => {
    const e = (name: string) => ({ name, data: new Uint8Array([1]) });
    expect(() => buildZip([e("../x")], "2026-01-01T00:00:00Z")).toThrow();
    expect(() => buildZip([e("/x")], "2026-01-01T00:00:00Z")).toThrow();
    expect(() => buildZip([e("a"), e("a")], "2026-01-01T00:00:00Z")).toThrow();
  });
  it("xlsx: injected text stays an inline string (never a formula) and markup is escaped", () => {
    const x = buildXlsx([{ name: "A/B:C", header: ["h"], rows: [["=1+1"], ["<b>&"], [idr("-12.5")]] }], "2026-01-01T00:00:00Z");
    const text = Buffer.from(x).toString("latin1");
    expect(unzipNames(x)).toContain("xl/worksheets/sheet1.xml");
    expect(text).not.toContain("<f>");
    expect(text).toContain("&lt;b&gt;&amp;");
    expect(text).toContain("-12.50");
    expect(text).not.toContain("A/B:C");
  });
  it("pdf: valid header/trailer, ASCII only, xref offsets point at objects", () => {
    const p = buildPdf({ title: "T", banner: "DEMO", footer: "f", lines: Array.from({ length: 120 }, (_, i) => ({ text: `Baris ${i} (x) \\ é`, amount: "1.00" })) });
    const s = Buffer.from(p).toString("latin1");
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    expect([...p].every((b) => b < 128)).toBe(true);
    const startxref = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(startxref, startxref + 4)).toBe("xref");
    const first = Number(/0000000000 65535 f \n(\d{10})/.exec(s)![1]);
    expect(s.slice(first, first + 7)).toBe("1 0 obj");
    expect((s.match(/\/Type \/Page /g) ?? []).length).toBeGreaterThan(1);
  });
});
