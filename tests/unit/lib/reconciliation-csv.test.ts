// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  MAX_EXPORT_DAYS,
  RECONCILIATION_HEADERS,
  buildReconciliationCsv,
  csvCell,
  formatWib,
  parseExportRange,
} from "@/lib/billing/reconciliation-csv";

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("csvCell — C5 escaping and formula-injection defence", () => {
  it("prefixes an apostrophe to strings a spreadsheet would read as a formula", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+62812")).toBe("'+62812");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tcmd")).toBe("'\tcmd");
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"');
  });
  it("leaves ordinary strings and real numbers alone", () => {
    expect(csvCell("PRO")).toBe("PRO");
    expect(csvCell(99000)).toBe("99000");
    expect(csvCell(-1)).toBe("-1");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(Number.NaN)).toBe("");
  });
  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("parseExportRange — WIB calendar days", () => {
  it("maps inclusive WIB days to a half-open UTC interval", () => {
    expect(parseExportRange("2026-11-01", "2026-11-07")).toEqual({
      ok: true,
      days: 7,
      fromIso: "2026-10-31T17:00:00.000Z",
      toExclusiveIso: "2026-11-07T17:00:00.000Z",
    });
  });
  it("accepts a single day", () => {
    expect(parseExportRange("2026-11-07", "2026-11-07")).toMatchObject({ ok: true, days: 1 });
  });
  it("rejects missing, malformed and impossible dates", () => {
    for (const [f, t] of [
      [undefined, "2026-11-07"],
      ["2026-11-01", undefined],
      ["11-01-2026", "2026-11-07"],
      ["2026-02-30", "2026-03-01"],
      ["2026-13-01", "2026-13-02"],
      ["2026-11-01T00:00:00Z", "2026-11-07"],
    ] as const) {
      expect(parseExportRange(f, t), `${f}/${t}`).toEqual({ ok: false, reason: "INVALID" });
    }
  });
  it("rejects a reversed range and one longer than the limit", () => {
    expect(parseExportRange("2026-11-07", "2026-11-01")).toEqual({ ok: false, reason: "REVERSED" });
    expect(parseExportRange("2026-01-01", "2026-12-31")).toEqual({ ok: false, reason: "TOO_LONG" });
    expect(MAX_EXPORT_DAYS).toBe(92);
  });
});

describe("buildReconciliationCsv", () => {
  const txn = (over: Partial<Parameters<typeof buildReconciliationCsv>[0][number]> = {}) => ({
    id: T1,
    tenant_id: TENANT,
    provider: "midtrans",
    provider_payment_id: "mid-tx-1",
    plan: "PRO",
    amount: 99000,
    currency: "IDR",
    paid_at: "2026-11-07T03:04:05.000Z",
    ...over,
  });
  const invoice = (over: Partial<Parameters<typeof buildReconciliationCsv>[1][number]> = {}) => ({
    id: "inv-1",
    transaction_id: T1,
    status: "PAID",
    amount: 99000,
    currency: "IDR",
    period_start: "2026-11-07",
    period_end: "2026-12-07",
    ...over,
  });

  it("formats an instant in WIB", () => {
    expect(formatWib("2026-11-07T03:04:05.000Z")).toBe("2026-11-07 10:04:05");
    expect(formatWib(null)).toBe("");
    expect(formatWib("garbage")).toBe("");
  });

  it("writes a header plus one row per PAID transaction with its invoice and an OK check", () => {
    const csv = buildReconciliationCsv([txn()], [invoice()]);
    expect(csv).toBe(
      `${RECONCILIATION_HEADERS.join(",")}\r\n` +
        `2026-11-07 10:04:05,${T1},${TENANT},PRO,midtrans,mid-tx-1,99000,IDR,inv-1,PAID,99000,2026-11-07,2026-12-07,OK\r\n`,
    );
  });

  it("flags a missing invoice, an unpaid invoice and an amount mismatch instead of hiding them", () => {
    const csv = buildReconciliationCsv(
      [txn(), txn({ id: T2 }), txn({ id: "33333333-3333-4333-8333-333333333333" })],
      [invoice({ transaction_id: T2, status: "OPEN" }), invoice({ id: "inv-3", transaction_id: "33333333-3333-4333-8333-333333333333", amount: 1 })],
    );
    const checks = csv.trim().split("\r\n").slice(1).map((l) => l.split(",").pop());
    expect(checks).toEqual(["NO_INVOICE", "INVOICE_NOT_PAID", "AMOUNT_MISMATCH"]);
  });

  it("neutralises a hostile value coming from the database", () => {
    const csv = buildReconciliationCsv([txn({ provider_payment_id: "=cmd|' /C calc'!A0" })], []);
    expect(csv).toContain(",'=cmd|' /C calc'!A0,");
  });

  it("contains only the declared columns — no card, token or raw gateway field", () => {
    expect(RECONCILIATION_HEADERS.join(",")).not.toMatch(/card|token|secret|key|signature|metadata|email|phone/i);
  });
});
