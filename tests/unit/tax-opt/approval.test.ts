import { describe, expect, it } from "vitest";
import type { AdminPrincipal } from "@/lib/admin/permissions";
import { calculationHash, canonicalJson, rulesVersion } from "@/lib/tax-opt/approval";
import { decide, prepareDecision, subjectKey, validEvidenceRef, type DecisionRequest, type DecisionStore, type RpcArgs } from "@/lib/tax-opt/decision";
import { mapRpcError } from "@/services/tax-optimization-approvals";

const P = (perms: string[], role = "SUPER_ADMIN") => ({ userId: "11111111-1111-4111-8111-111111111111", role, permissions: new Set(perms) }) as unknown as AdminPrincipal;
const founder = P(["tax.optimization.approve", "tax.optimization.view"]);
const staff = P(["tax.optimization.view"], "FINANCE_ADMIN");
const H = "a".repeat(64);
const RV = "taxopt-e1;law=2026-10-27;reg=abc";
const base = (o: Partial<DecisionRequest> = {}): DecisionRequest => ({
  requestId: "22222222-2222-4222-8222-222222222222",
  recommendationType: "SCHEME_SELECTION",
  taxYear: "2026",
  items: ["PASAL_31E"],
  decision: "APPROVED",
  reason: "Ditinjau bersama akuntan.",
  viewed: { calcHash: H, rulesVersion: RV },
  current: { calcHash: H, rulesVersion: RV, figureStates: ["TERVERIFIKASI"], openItems: 0 },
  evidenceRefs: ["BUKTI-001"],
  accountantVerificationRef: "AKT-2026-01",
  expectedSeq: 0,
  ...o,
});
const okStore = (calls: RpcArgs[] = []): DecisionStore => ({ record: async (a) => (calls.push(a), { ok: true, id: "e1" }) });

describe("hashes", () => {
  it("canonical JSON is key-order independent and handles bigint", () => {
    expect(canonicalJson({ b: BigInt(1), a: [2, { d: 1, c: undefined }] })).toBe(canonicalJson({ a: [2, { d: 1 }], b: BigInt(1) }));
  });
  it("calculation hash changes when any input or result changes", () => {
    const a = calculationHash({ input: { x: 1 }, result: { y: 2 } });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(calculationHash({ input: { x: 1 }, result: { y: 3 } })).not.toBe(a);
    expect(calculationHash({ input: { x: 2 }, result: { y: 2 } })).not.toBe(a);
    expect(calculationHash({ input: { x: 1 }, result: { y: 2 } })).toBe(a);
  });
  it("rules version is stable and names the verification date", () => {
    expect(rulesVersion()).toBe(rulesVersion());
    expect(rulesVersion()).toContain("law=2026-10-27");
  });
});

describe("prepareDecision", () => {
  it("accepts a valid Founder approval; actor is the session user", () => {
    const r = prepareDecision(founder, base());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rpc.p_actor).toBe("11111111-1111-4111-8111-111111111111");
      expect(r.rpc.p_subject_key).toBe(subjectKey("SCHEME_SELECTION", "2026", ["PASAL_31E"]));
    }
  });
  it("rejects staff, customers and no session", () => {
    for (const p of [staff, P([], "STAFF"), null]) {
      const r = prepareDecision(p, base());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("FORBIDDEN");
    }
  });
  it("rejects stale calculation and rules-version mismatch", () => {
    const a = prepareDecision(founder, base({ viewed: { calcHash: "b".repeat(64), rulesVersion: RV } }));
    const b = prepareDecision(founder, base({ viewed: { calcHash: H, rulesVersion: "old" } }));
    expect(a.ok || a.code).toBe("STALE");
    expect(b.ok || b.code).toBe("STALE");
  });
  it("approval needs TERVERIFIKASI figures and no open items; rejection does not", () => {
    for (const cur of [
      { figureStates: ["SIMULASI"], openItems: 0 },
      { figureStates: [], openItems: 0 },
      { figureStates: ["TERVERIFIKASI"], openItems: 2 },
      { figureStates: ["TERVERIFIKASI", "PERLU_VERIFIKASI_AKUNTAN"], openItems: 0 },
    ] as const) {
      const r = prepareDecision(founder, base({ current: { calcHash: H, rulesVersion: RV, ...cur } }));
      expect(r.ok || r.code).toBe("NOT_VERIFIED");
    }
    expect(prepareDecision(founder, base({ decision: "REJECTED", current: { calcHash: H, rulesVersion: RV, figureStates: ["SIMULASI"], openItems: 3 } })).ok).toBe(true);
  });
  it("rejects bad input: reason, items, year, combined final+31E, evidence links", () => {
    const bad: Partial<DecisionRequest>[] = [
      { reason: "pendek" }, { reason: " ".repeat(30) }, { items: [] }, { items: ["bad id"] }, { taxYear: "26" }, { requestId: "x" },
      { items: ["PPH_FINAL_UMKM", "PASAL_31E"] }, { evidenceRefs: ["https://x.example/a.pdf"] }, { evidenceRefs: ["/etc/passwd"] }, { evidenceRefs: ["a/../b"] },
      { expectedSeq: -1 }, { expectedSeq: 1.5 },
    ];
    for (const b of bad) expect(prepareDecision(founder, base(b)).ok).toBe(false);
  });
  it("evidence references are short ids only", () => {
    expect(validEvidenceRef("BUKTI-001")).toBe(true);
    expect(validEvidenceRef("https://a.b/c")).toBe(false);
    expect(validEvidenceRef("ab")).toBe(false);
  });
});

describe("decide", () => {
  it("never calls the store when preparation fails", async () => {
    const calls: RpcArgs[] = [];
    const r = await decide(staff, base(), okStore(calls));
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
  it("passes exactly the prepared arguments to the store", async () => {
    const calls: RpcArgs[] = [];
    const r = await decide(founder, base(), okStore(calls));
    expect(r).toEqual({ ok: true, id: "e1" });
    expect(calls).toHaveLength(1);
    expect(calls[0].p_expected_seq).toBe(0);
  });
  it.each(["CONFLICT", "STALE", "FORBIDDEN", "UNAVAILABLE"] as const)("maps store %s", async (code) => {
    const r = await decide(founder, base(), { record: async () => ({ ok: false, code }) });
    expect(r.ok || r.code).toBe(code);
  });
  it("a throwing store fails closed", async () => {
    const r = await decide(founder, base(), { record: async () => { throw new Error("boom"); } });
    expect(r.ok || r.code).toBe("UNAVAILABLE");
  });
  it("double submission with same request id is sent identically (database makes it idempotent)", async () => {
    const calls: RpcArgs[] = [];
    await decide(founder, base(), okStore(calls));
    await decide(founder, base(), okStore(calls));
    expect(calls[0].p_request_id).toBe(calls[1].p_request_id);
  });
  it("approval does not alter the figures it was given", async () => {
    const req = base();
    const before = JSON.stringify(req.current);
    await decide(founder, req, okStore());
    expect(JSON.stringify(req.current)).toBe(before);
  });
});

describe("mapRpcError", () => {
  it("fails closed", () => {
    expect(mapRpcError({ code: "42501" })).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(mapRpcError({ code: "TO409" })).toEqual({ ok: false, code: "CONFLICT" });
    expect(mapRpcError({ message: "x TO412 y" })).toEqual({ ok: false, code: "STALE" });
    expect(mapRpcError({ code: "42P01" })).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(mapRpcError({})).toEqual({ ok: false, code: "UNAVAILABLE" });
  });
});
