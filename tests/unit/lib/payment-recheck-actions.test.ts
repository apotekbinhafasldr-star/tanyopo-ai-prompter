// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const { operatorMock, recheckMock, providerMock } = vi.hoisted(() => ({
  operatorMock: vi.fn(),
  recheckMock: vi.fn(),
  providerMock: vi.fn(() => ({ name: "doku" })),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/payment-operator", () => ({ getPaymentOperator: operatorMock }));
vi.mock("@/services/payment-recheck", () => ({ recheckPendingPayment: recheckMock }));
vi.mock("@/lib/billing/get-payment-provider", () => ({ getPaymentProvider: providerMock }));

import { recheckPaymentAction } from "../../../app/ops/payments/recheck-actions";

const TXN = "11111111-1111-4111-8111-111111111111";
const form = (id: unknown) => {
  const f = new FormData();
  if (id !== undefined) f.set("transactionId", String(id));
  return f;
};
const run = async (id: unknown) => {
  try {
    await recheckPaymentAction(form(id));
  } catch (e) {
    return (e as Error).message;
  }
  return "NO_REDIRECT";
};

let userSeq = 0;
beforeEach(() => {
  operatorMock.mockReset();
  recheckMock.mockReset();
  userSeq += 1; // a fresh rate-limit bucket per test
});
const asOperator = () => operatorMock.mockResolvedValue({ userId: `00000000-0000-4000-8000-${String(userSeq).padStart(12, "0")}`, admin: { marker: "admin" } });

describe("recheckPaymentAction (P0-C) — role gate, rate limit, no free input", () => {
  it("a non-operator (tenant owner, admin, anonymous) is denied and nothing is verified", async () => {
    operatorMock.mockResolvedValue(null);
    expect(await run(TXN)).toBe("REDIRECT:/ops/payments?r=denied&ok=0");
    expect(recheckMock).not.toHaveBeenCalled();
    expect(providerMock).not.toHaveBeenCalled();
  });

  it("an operator with a valid id calls the service with the server-resolved provider and the operator's own id", async () => {
    asOperator();
    recheckMock.mockResolvedValue({ ok: true, code: "applied" });
    expect(await run(TXN)).toBe("REDIRECT:/ops/payments?r=recheck_applied&ok=1");
    expect(recheckMock).toHaveBeenCalledTimes(1);
    const [adminArg, , idArg, opArg] = recheckMock.mock.calls[0];
    expect(adminArg).toEqual({ marker: "admin" });
    expect(idArg).toBe(TXN);
    expect(opArg).toMatch(/^00000000-0000-4000-8000-/);
  });

  it.each(["", "x", "1; drop table", undefined])("an invalid id %j is rejected before the service", async (bad) => {
    asOperator();
    expect(await run(bad)).toBe("REDIRECT:/ops/payments?r=invalid&ok=0");
    expect(recheckMock).not.toHaveBeenCalled();
  });

  it("maps a failed result to ok=0 with a fixed code (no free text from the service)", async () => {
    asOperator();
    recheckMock.mockResolvedValue({ ok: false, code: "unverifiable" });
    expect(await run(TXN)).toBe("REDIRECT:/ops/payments?r=recheck_unverifiable&ok=0");
  });

  it("the 7th click within a minute is rate limited and does not reach the service", async () => {
    asOperator();
    recheckMock.mockResolvedValue({ ok: true, code: "still_pending" });
    for (let i = 0; i < 6; i++) expect(await run(TXN)).toContain("recheck_still_pending");
    expect(await run(TXN)).toBe("REDIRECT:/ops/payments?r=rate&ok=0");
    expect(recheckMock).toHaveBeenCalledTimes(6);
  });
});

describe("P0-C static guards", () => {
  const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("the recheck service only settles through verifyAndSettle and never calls the activation RPC or edits transactions/subscriptions", () => {
    const src = strip(read("services/payment-recheck.ts"));
    expect(src).toContain("verifyAndSettle");
    expect(src).not.toMatch(/fn_apply_verified_payment|fn_resolve_review_payment|fn_begin_checkout|prompter_subscriptions/);
    expect(src).not.toMatch(/\.(update|upsert|delete)\(/);
    expect(src).not.toMatch(/\.from\("prompter_payment_transactions"\)\s*\.(insert|update)/);
    expect(src).toMatch(/^import "server-only";/m);
  });

  it("the health service is read-only and never selects secrets beyond what it counts", () => {
    const src = strip(read("services/payment-health.ts"));
    expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(|\.rpc\(/);
    expect(src).toMatch(/^import "server-only";/m);
  });

  it("the action uses the dedicated operator allowlist, takes only a transaction id, and the page stays a server component", () => {
    const act = strip(read("app/ops/payments/recheck-actions.ts"));
    expect(act.match(/await getPaymentOperator\(\)/g)?.length).toBe(1);
    expect(act).toContain('formData.get("transactionId")');
    expect(act).not.toMatch(/formData\.get\("(amount|status|plan|tenant|provider)/);
    const page = strip(read("app/ops/payments/page.tsx"));
    expect(page).toContain("getPaymentOperator()");
    expect(page).not.toMatch(/["']use client["']/);
    expect(page).not.toMatch(/verifyAndSettle|fn_apply_verified_payment|prompter_payment_transactions/);
  });
});
