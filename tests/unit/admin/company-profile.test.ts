import { describe, expect, it } from "vitest";
import { toDecimalString } from "@/lib/finance/money";
import { runOptimization } from "@/lib/tax-opt";
import { buildDemoOptimization } from "@/lib/admin/demo-optimization";
import { COMPANY, COMPANY_STATUS, FOUNDER_SPEND_RECAP, founderSpendRecord, pendingProfile, pendingTurnover } from "@/lib/admin/company-profile";

describe("PT Tanyopo pending-verification configuration", () => {
  it("states the facts the Founder gave, all waiting for documents", () => {
    expect(COMPANY).toMatchObject({ name: "PT Tanyopo Future Technology", legalForm: "PT_PERORANGAN", foundedYear: "2026", npwpRegisteredOn: "2026-09-17", pkpStatus: "NON_PKP", status: COMPANY_STATUS });
    expect(COMPANY_STATUS).toBe("MENUNGGU_VERIFIKASI_DOKUMEN");
    expect(COMPANY.documentsNeeded.length).toBeGreaterThan(3);
  });
  it("never treats the NPWP date as the founding date", () => {
    expect(COMPANY.foundedYear).not.toBe(COMPANY.npwpRegisteredOn);
    expect(Object.keys(COMPANY)).not.toContain("foundedOn");
  });
  it("holds no NPWP number, email or personal identity data", () => {
    const text = JSON.stringify({ COMPANY, p: pendingProfile() });
    expect(text).not.toMatch(/\b\d{2}\.\d{3}\.\d{3}\.\d-\d{3}\.\d{3}\b/);
    expect(text).not.toMatch(/\d{15,16}/);
    expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  });
  it("nothing in the profile or turnover is verified", () => {
    const p = pendingProfile();
    expect(p.verifiedBy).toBeNull();
    expect(p.verifiedAt).toBeNull();
    const t = pendingTurnover();
    expect(t.verifiedBy).toBeNull();
    expect(t.complete).toBe(false);
    expect(toDecimalString(t.amount!)).toBe("0.00");
  });
  it("Founder spend recap is Rp4.279.425, unclassified, with no receipt and no review", () => {
    expect(toDecimalString(FOUNDER_SPEND_RECAP)).toBe("4279425.00");
    const rec = founderSpendRecord();
    expect(rec.receiptRef).toBe("");
    const input = buildDemoOptimization("nyata");
    expect(input.expenses).toHaveLength(1);
    expect(input.expenseReviews).toHaveLength(0);
  });
  it("the engine concludes nothing from it: no scheme eligibility, no deductible cost, not ready", () => {
    const r = runOptimization(buildDemoOptimization("nyata"));
    for (const s of r.schemes.results) expect(s.eligibility).toBe("BELUM_DAPAT_DIHITUNG");
    expect(toDecimalString(r.expenses.deductibleVerified)).toBe("0.00");
    expect(toDecimalString(r.expenses.nonDeductibleVerified)).toBe("0.00");
    expect(toDecimalString(r.expenses.needsAttention)).toBe("4279425.00");
    expect(r.readyToUse).toBe(false);
    expect(r.ppn.active).toBe(false);
    for (const l of r.simulation.lines) expect(l.figure.state).not.toBe("TERVERIFIKASI");
  });
  it("the fixture is configuration only: no ledger or database import", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("lib/admin/company-profile.ts", "utf-8");
    expect(src).not.toMatch(/supabase|services\/|accounting\/ledger|postJournal|insert\(/);
  });
});
