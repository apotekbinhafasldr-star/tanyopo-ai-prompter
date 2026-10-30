// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildMidtransEventRef } from "@/lib/billing/providers/midtrans-payment-provider";

const base = { transaction_status: "partial_refund", status_code: "200", fraud_status: "accept" };

describe("Billing B4.1 — Midtrans event identity (evidence ref)", () => {
  it("is stable for the same gateway state and has the gw: prefix", () => {
    const a = buildMidtransEventRef({ ...base, refund_amount: "10000" });
    const b = buildMidtransEventRef({ ...base, refund_amount: "10000" });
    expect(a.ref).toBe(b.ref);
    expect(a.ref).toMatch(/^gw:[0-9a-f]{40}$/);
    expect(a.basis).toBe("detailed");
  });
  it("changes when the refund total, a refund counter or a refund id changes", () => {
    const first = buildMidtransEventRef({ ...base, refund_amount: "10000" }).ref;
    expect(buildMidtransEventRef({ ...base, refund_amount: "25000" }).ref).not.toBe(first);
    expect(buildMidtransEventRef({ ...base, refund_amount: "10000", refund_count: 2 }).ref).not.toBe(first);
    const withList = (keys: string[]) => buildMidtransEventRef({ ...base, refunds: keys.map((k) => ({ refund_key: k, refund_amount: 5000 })) }).ref;
    expect(withList(["a"])).not.toBe(withList(["a", "b"]));
    expect(withList(["a", "b"])).toBe(withList(["a", "b"]));
  });
  it("differs per status words (refund vs chargeback)", () => {
    expect(buildMidtransEventRef({ ...base, transaction_status: "chargeback" }).ref).not.toBe(buildMidtransEventRef(base).ref);
  });
  it("reports status_only when the answer has no refund / chargeback specifics (documented limitation)", () => {
    expect(buildMidtransEventRef(base).basis).toBe("status_only");
    expect(buildMidtransEventRef({ ...base, refunds: [] }).basis).toBe("status_only");
  });
  it("ignores unrelated and hostile fields, tolerates garbage, and is bounded", () => {
    const clean = buildMidtransEventRef({ ...base, refund_amount: "1" }).ref;
    expect(buildMidtransEventRef({ ...base, refund_amount: "1", evidenceRef: "evil", note: "x".repeat(100000) }).ref).toBe(clean);
    expect(() => buildMidtransEventRef({ ...base, refunds: [null, 5, "x", { refund_key: { nested: true } }] })).not.toThrow();
    const huge = Array.from({ length: 5000 }, (_, i) => ({ refund_key: `k${i}` }));
    expect(buildMidtransEventRef({ ...base, refunds: huge }).ref).toMatch(/^gw:[0-9a-f]{40}$/);
  });
});
