import { describe, expect, it } from "vitest";
import {
  UNVERIFIED_TAX_CONFIG,
  isTaxConfigVerified,
  money,
  neutralizeFormula,
  toCsv,
  turnoverRecap,
  type TaxConfig,
} from "@/lib/finance";
import { d, idr, newBook, payment, refund } from "./helpers";

function book() {
  const b = newBook();
  b.ingestPayment(payment("pay_1"));
  b.ingestPayment(payment("pay_2", { paidAt: "2026-12-02T03:00:00Z", servicePeriodStart: "2026-12-01", servicePeriodEnd: "2026-12-31" }));
  b.ingestRefund(refund("r1", "pay_1", "100000"));
  return b.snapshot();
}

// Fixture values only: the product ships NO default rate.
const verified = (over: Partial<TaxConfig>): TaxConfig => ({
  ...UNVERIFIED_TAX_CONFIG,
  verifiedBy: "accountant",
  verifiedAt: "2026-10-01T00:00:00Z",
  ...over,
});

describe("tax turnover recap", () => {
  it("reports turnover but computes NO tax without verified config", () => {
    const recap = turnoverRecap(book(), "2026");
    expect(recap.configVerified).toBe(false);
    expect(d(recap.yearTurnover)).toBe("500000.00");
    for (const m of recap.months) {
      expect(m.ppn.status).toBe("NOT_CONFIGURED");
      expect(m.finalTax.status).toBe("NOT_CONFIGURED");
    }
    expect(recap.warnings.length).toBeGreaterThan(0);
  });

  it("a rate typed in without a verifier is still not used", () => {
    const cfg: TaxConfig = { ...UNVERIFIED_TAX_CONFIG, pkpStatus: "PKP", ppnRateBps: 1100, pricesIncludePpn: false };
    expect(isTaxConfigVerified(cfg)).toBe(false);
    expect(turnoverRecap(book(), "2026", cfg).months[0].ppn.status).toBe("NOT_CONFIGURED");
  });

  it("net turnover is receipts minus processed refunds, per month", () => {
    const [nov, dec] = turnoverRecap(book(), "2026").months;
    expect(nov.month).toBe("2026-11");
    expect(d(nov.netTurnover)).toBe("200000.00");
    expect(dec.month).toBe("2026-12");
    expect(d(dec.netTurnover)).toBe("300000.00");
  });

  it("computes PPN only for a verified PKP with rate and price basis configured", () => {
    const exclusive = turnoverRecap(book(), "2026", verified({ pkpStatus: "PKP", ppnRateBps: 1100, pricesIncludePpn: false }));
    const nov = exclusive.months[0].ppn;
    expect(nov.status === "COMPUTED" && d(nov.amount)).toBe("22000.00");
    const inclusive = turnoverRecap(book(), "2026", verified({ pkpStatus: "PKP", ppnRateBps: 1100, pricesIncludePpn: true }));
    const dec = inclusive.months[1].ppn;
    expect(dec.status === "COMPUTED" && d(dec.amount)).toBe("29729.73");
  });

  it("non-PKP has no PPN; missing price basis is reported, not guessed", () => {
    expect(turnoverRecap(book(), "2026", verified({ pkpStatus: "NON_PKP" })).months[0].ppn.status).toBe("NOT_APPLICABLE");
    expect(turnoverRecap(book(), "2026", verified({ pkpStatus: "PKP", ppnRateBps: 1100 })).months[0].ppn.status).toBe("NOT_CONFIGURED");
  });

  it("final tax needs its own configured rate; threshold is optional and caller-supplied", () => {
    const none = turnoverRecap(book(), "2026", verified({ pkpStatus: "NON_PKP" }));
    expect(none.months[0].finalTax.status).toBe("NOT_CONFIGURED");
    expect(none.thresholdReached).toBeNull();
    const cfg = verified({ pkpStatus: "NON_PKP", finalTaxRateBps: 50, annualThreshold: idr("400000") });
    const recap = turnoverRecap(book(), "2026", cfg);
    const nov = recap.months[0].finalTax;
    expect(nov.status === "COMPUTED" && d(nov.amount)).toBe("1000.00");
    expect(recap.thresholdReached).toBe(true);
  });
});

describe("CSV export — formula injection prevention", () => {
  it.each(["=SUM(A1)", "+1+1", "-2+3", "@cmd", "\t=1", "\r=1", "  =HYPERLINK(\"x\")", " =1"])(
    "neutralises %j",
    (payload) => {
      expect(neutralizeFormula(payload).startsWith("'")).toBe(true);
    },
  );

  it("leaves ordinary text alone", () => {
    expect(neutralizeFormula("PT Maju Jaya")).toBe("PT Maju Jaya");
    expect(neutralizeFormula("a=b")).toBe("a=b");
  });

  it("neutralises dangerous free text but keeps real negative money numeric", () => {
    const csv = toCsv(["vendor", "amount"], [["=cmd|' /C calc'!A0", money("-1500.5", "IDR")], ["Normal, Inc", money("10", "IDR")]]);
    expect(csv).toBe("vendor,amount\r\n'=cmd|' /C calc'!A0,-1500.50\r\n\"Normal, Inc\",10.00\r\n");
  });

  it("neutralises dangerous headers and quotes embedded quotes and newlines", () => {
    const csv = toCsv(["=bad", "note"], [["x", 'say "hi"\nnow']]);
    expect(csv.split("\r\n")[0]).toBe("'=bad,note");
    expect(csv).toContain('"say ""hi""\nnow"');
  });

  it("rejects ragged rows and non-finite numbers", () => {
    expect(() => toCsv(["a", "b"], [["only one"]])).toThrow();
    expect(() => toCsv(["a"], [[Number.POSITIVE_INFINITY]])).toThrow();
  });
});
