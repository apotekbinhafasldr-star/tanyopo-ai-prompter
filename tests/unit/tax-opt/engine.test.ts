import { describe, expect, it } from "vitest";
import { money, toDecimalString, zero } from "@/lib/finance/money";
import {
  claimCredits, evaluateSchemes, legalParametersFor, reviewCredits, reviewPpn, checkNotice,
  simulate, tax31E, taxFinalUmkm, taxGeneral, validateSchemeSelection, reviewExpenses, expenseAdjustments, blocked, computed,
  type EntityProfile, type SchemeInput, type TaxCreditRecord,
} from "@/lib/tax-opt";

const M = (v: string) => money(v, "IDR");
const V = { verifiedBy: "Akuntan", verifiedAt: "2026-10-27" };
const LEGAL = legalParametersFor("2026", V)!;
const LEGAL_UNVER = legalParametersFor("2026")!;
const profile = (o: Partial<EntityProfile> = {}): EntityProfile => ({
  legalForm: "PT", registeredOn: "2023-03-01", isPublicListed: false, hasOtherIncomeTaxFacility: false,
  isPermanentEstablishment: false, electedNormalRate: false, providesFreeProfessionServices: false, ...V, ...o,
});
const input = (o: Partial<SchemeInput> = {}): SchemeInput => ({
  taxYear: "2026", profile: profile(), turnover: { amount: M("1000000000"), complete: true, ...V },
  taxableIncome: M("200000000"), taxableIncomeVerified: true, legal: LEGAL, ...o,
});
const get = (e: ReturnType<typeof evaluateSchemes>, id: string) => e.results.find((r) => r.id === id)!;

describe("tax math", () => {
  it("general rate exact", () => expect(toDecimalString(taxGeneral(M("200000000"), LEGAL))).toBe("44000000.00"));
  it("31E turnover below cap: half rate on full income", () => {
    expect(toDecimalString(tax31E(M("200000000"), M("1000000000"), LEGAL))).toBe("22000000.00");
  });
  it("31E turnover above 4.8bn: only proportion gets discount", () => {
    // omzet 9.6bn: half of income gets 11%, rest 22%
    expect(toDecimalString(tax31E(M("1000000000"), M("9600000000"), LEGAL))).toBe("165000000.00");
  });
  it("31E matches the official DJP worked example (omzet 30bn, PKP 5bn -> 1,012,000,000)", () => {
    expect(toDecimalString(tax31E(M("5000000000"), M("30000000000"), LEGAL))).toBe("1012000000.00");
  });
  it("PT biasa vs PT perorangan under PP 20/2026", () => {
    const fin = (o: Partial<EntityProfile>, year: string) =>
      get(evaluateSchemes(input({ taxYear: year, profile: profile(o), legal: legalParametersFor(year, V)! })), "PPH_FINAL_UMKM").eligibility;
    // PT biasa registered 2022: PP 23/2018 Pasal 5 counts from the registration year -> 2022, 2023, 2024.
    expect(fin({ registeredOn: "2022-03-01" }, "2024")).toBe("MEMENUHI_SYARAT");
    expect(fin({ registeredOn: "2022-03-01" }, "2025")).toBe("PERLU_VERIFIKASI_AKUNTAN"); // PP 55/2022 Pasal 59 BLOCKED
    expect(fin({ registeredOn: "2022-03-01" }, "2026")).toBe("TIDAK_MEMENUHI");
    // A year without verified rules is never computed.
    expect(fin({ registeredOn: "2022-03-01" }, "2027")).toBe("BELUM_DAPAT_DIHITUNG");
    // Perseroan perorangan (1 owner): no time window.
    expect(fin({ legalForm: "PT_PERORANGAN", registeredOn: "2020-01-01" }, "2026")).toBe("MEMENUHI_SYARAT");
    expect(fin({ legalForm: "PT_PERORANGAN", registeredOn: "2026-06-01", providesFreeProfessionServices: true }, "2026")).toBe("TIDAK_MEMENUHI");
    // Facilities cannot be combined with final tax.
    expect(fin({ hasOtherIncomeTaxFacility: true }, "2025")).toBe("TIDAK_MEMENUHI");
    expect(fin({ electedNormalRate: true }, "2025")).toBe("TIDAK_MEMENUHI");
  });
  it("final UMKM 0.5% of turnover, no rounding drift", () => {
    expect(toDecimalString(taxFinalUmkm(M("1234567891"), LEGAL))).toBe("6172839.46");
  });
  it("final tax differs from nonfinal even at a loss", () => {
    expect(toDecimalString(taxGeneral(M("-5000000"), LEGAL))).toBe("0.00");
    expect(toDecimalString(taxFinalUmkm(M("100000000"), LEGAL))).toBe("500000.00");
  });
});

describe("scheme eligibility", () => {
  it("never recommends and 31E eligible with verified data", () => {
    const e = evaluateSchemes(input());
    expect(e.recommended).toBeNull();
    expect(get(e, "PASAL_31E").eligibility).toBe("MEMENUHI_SYARAT");
    expect(get(e, "PASAL_31E").tax.state).toBe("TERVERIFIKASI");
  });
  it("unverified legal parameters never TERVERIFIKASI", () => {
    const e = evaluateSchemes(input({ legal: LEGAL_UNVER }));
    expect(get(e, "PASAL_31E").tax.state).not.toBe("TERVERIFIKASI");
  });
  it("turnover over 50bn: no 31E", () => {
    const e = evaluateSchemes(input({ turnover: { amount: M("60000000000"), complete: true, ...V } }));
    expect(get(e, "PASAL_31E").eligibility).toBe("TIDAK_MEMENUHI");
  });
  it("final UMKM not available to a new PT (non-perorangan)", () => {
    const e = evaluateSchemes(input({ profile: profile({ registeredOn: "2026-05-01" }) }));
    expect(get(e, "PPH_FINAL_UMKM").eligibility).toBe("TIDAK_MEMENUHI");
  });
  it("incomplete entity turnover is rejected: BELUM DAPAT DIHITUNG, no amount", () => {
    const e = evaluateSchemes(input({ turnover: { amount: M("1000000000"), complete: false, ...V } }));
    for (const r of e.results.filter((x) => x.id !== "PPH_BADAN_UMUM" || true)) {
      if (r.id === "PASAL_31E" || r.id === "PPH_FINAL_UMKM") {
        expect(r.eligibility).toBe("BELUM_DAPAT_DIHITUNG");
        expect(r.tax.amount).toBeNull();
      }
    }
  });
  it("missing profile and unsupported year give no numbers", () => {
    expect(get(evaluateSchemes(input({ profile: null })), "PASAL_31E").tax.amount).toBeNull();
    expect(legalParametersFor("2019")).toBeNull();
    expect(get(evaluateSchemes(input({ legal: null, taxYear: "2019" })), "PASAL_31E").tax.amount).toBeNull();
  });
  it("conflicting facilities cannot be combined", () => {
    expect(validateSchemeSelection(["PPH_FINAL_UMKM", "PASAL_31E"]).ok).toBe(false);
    expect(validateSchemeSelection(["PPH_FINAL_UMKM", "PPH_BADAN_UMUM"]).ok).toBe(false);
    expect(validateSchemeSelection(["PASAL_31E"]).ok).toBe(true);
  });
});

const exp = (id: string, o: Record<string, unknown> = {}) => ({
  id, date: "2026-03-01", category: "SERVER", vendor: "Vendor", amount: M("1000000"), taxAmount: zero("IDR"), receiptRef: `R-${id}`, isVoid: false, ...o,
}) as never;
const rev = (id: string, o: Record<string, unknown> = {}) => ({
  expenseId: id, businessPurpose: "Hosting produk", accountingAccount: "6101", treatment: "DAPAT_DIKURANGKAN", legalBasis: "UU PPh Pasal 6(1)", ...V, ...o,
}) as never;

describe("expense review", () => {
  it("only verified and deductible become adjustments; ledger inputs untouched", () => {
    const ex = [exp("1"), exp("2", { vendor: "Lain" })];
    const snapshot = JSON.stringify(ex, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    const nd = rev("1", { treatment: "TIDAK_DAPAT_DIKURANGKAN", legalBasis: "UU PPh Pasal 9 (perlu konfirmasi)" });
    const r = reviewExpenses(ex, [nd], "IDR");
    const adj = expenseAdjustments(ex, [nd], "IDR");
    expect(adj).toHaveLength(1);
    expect(adj[0].direction).toBe("POSITIVE");
    expect(adj[0].id).toBe("opt|expense|1");
    expect(r.findings.find((f) => f.expenseId === "2")!.status).toBe("PERLU_DILENGKAPI");
    expect(JSON.stringify(ex, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(snapshot);
  });
  it("duplicate receipts are flagged, not claimed twice", () => {
    const ex = [exp("1"), exp("2", { receiptRef: "R-1", vendor: "Lain" })];
    const r = reviewExpenses(ex, [rev("1"), rev("2")], "IDR");
    expect(r.findings.filter((f) => f.status === "DUGAAN_GANDA").length).toBeGreaterThan(0);
  });
  it("unverified review is not trusted", () => {
    const r = reviewExpenses([exp("1")], [rev("1", { verifiedBy: null, verifiedAt: null })], "IDR");
    expect(r.findings[0].status).toBe("PERLU_DILENGKAPI");
  });
});

const cr = (id: string, o: Partial<TaxCreditRecord> = {}): TaxCreditRecord => ({
  id, kind: "PPH23", taxYear: "2026", date: "2026-02-01", amount: M("500000"), evidenceRef: `BP-${id}`, counterparty: "PT X", claimedIn: null, ...V, ...o,
});

describe("credits", () => {
  it("final tax is a payment, not a credit", () => {
    const r = reviewCredits([cr("1", { kind: "PPH_FINAL" }), cr("2")], "2026", "SPT-1", "IDR");
    expect(r.findings.find((f) => f.id === "1")!.status).toBe("BUKAN_KREDIT_PAJAK_FINAL");
    expect(toDecimalString(r.creditableVerified)).toBe("500000.00");
    expect(toDecimalString(r.paidVerified)).toBe("1000000.00");
  });
  it("duplicate evidence and probable double payment are not counted twice", () => {
    const r = reviewCredits([cr("1"), cr("2", { evidenceRef: "BP-1" }), cr("3", { evidenceRef: "BP-3" })], "2026", "SPT-1", "IDR");
    expect(toDecimalString(r.creditableVerified)).toBe("500000.00");
    expect(r.flagged).toBeGreaterThan(0);
  });
  it("cannot claim twice", () => {
    const first = claimCredits([cr("1")], ["1"], "SPT-1", "2026", "IDR");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(claimCredits(first.records, ["1"], "SPT-2", "2026", "IDR").ok).toBe(false);
  });
  it("unverified, no-proof, and other-year credits are excluded", () => {
    const r = reviewCredits([cr("1", { verifiedBy: null, verifiedAt: null }), cr("2", { evidenceRef: "" }), cr("3", { taxYear: "2025" })], "2026", "SPT-1", "IDR");
    expect(toDecimalString(r.creditableVerified)).toBe("0.00");
  });
});

describe("PPN", () => {
  it("inactive without verified PKP", () => {
    expect(reviewPpn({ pkpVerified: false, fakturs: [], currency: "IDR" }).active).toBe(false);
  });
});

describe("notices", () => {
  it("never concludes DJP is wrong and computes keberatan deadline", () => {
    const c = checkNotice({
      id: "n1", type: "SKPKB", number: "00001/X", taxType: "PPh Badan", period: "2025", issuedOn: "2026-08-30", sentOn: "2026-08-31",
      assessed: M("10000000"), ourComputation: M("4000000"), sanctionAmount: null, legalBasisOnNotice: null, evidence: [],
    } as never, "IDR");
    expect(c.conclusion).toBe("TIDAK_DISIMPULKAN");
    expect(c.paths.find((p) => p.id === "KEBERATAN")!.deadline).toBe("2026-11-30");
  });
});

describe("simulation + decision", () => {
  const e = (o: Partial<SchemeInput> = {}) => evaluateSchemes(input(o));
  const simIn = (sch = e(), credits = reviewCredits([cr("1")], "2026", "C", "IDR")) => ({
    currency: "IDR", legal: LEGAL, profitBeforeAdjustments: M("200000000"), inputsVerified: true, schemes: sch, credits, creditRecordCount: 1,
  });
  it("complete verified: final = tax after facility - credits; saving not certain wording", () => {
    const s = simulate(simIn());
    const fin = s.lines.find((l) => l.id === "FINAL")!.figure;
    expect(toDecimalString(fin.amount!)).toBe("21500000.00");
    expect(s.savingsTotal.assumptions.join(" ")).toContain("bukan jaminan");
    expect(toDecimalString(s.savingsTotal.amount!)).toBe("22000000.00");
  });
  it("incomplete data: BELUM DAPAT DIHITUNG with no amount", () => {
    const s = simulate(simIn(e({ turnover: { amount: null, complete: false, ...V } })));
    expect(s.savingsTotal.amount).toBeNull();
    expect(s.savingsTotal.state).toBe("BELUM_DAPAT_DIHITUNG");
  });
  it("no credit records: final not computed (zero means no data)", () => {
    const s = simulate({ ...simIn(), creditRecordCount: 0 });
    expect(s.lines.find((l) => l.id === "FINAL")!.figure.amount).toBeNull();
  });
  it("unverified law caps at SIMULASI", () => {
    const s = simulate({ ...simIn(e({ legal: LEGAL_UNVER })), legal: LEGAL_UNVER });
    expect(s.lines.find((l) => l.id === "FINAL")!.figure.state).not.toBe("TERVERIFIKASI");
  });
  it("figure invariants: blocked has no amount; computed unverified is SIMULASI", () => {
    expect(blocked(["x"]).amount).toBeNull();
    expect(computed(M("1"), { legalVerified: false, inputsVerified: true, sourceIds: [], assumptions: [] }).state).toBe("SIMULASI");
  });
});
