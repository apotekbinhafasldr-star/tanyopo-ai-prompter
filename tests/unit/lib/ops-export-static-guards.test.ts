// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

describe("C5 export route — static guards", () => {
  const route = read("app/ops/payments/export/route.ts");

  it("is GET-only and read-only", () => {
    expect(route).toMatch(/export async function GET\b/);
    expect(route).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)\b/);
    expect(route).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
  });

  it("is gated by the payment-operator check BEFORE any database read, and answers a bare 404 otherwise", () => {
    expect(route.indexOf("getPaymentOperator()")).toBeGreaterThan(-1);
    expect(route.indexOf("getPaymentOperator()")).toBeLessThan(route.indexOf(".from("));
    expect(route).toContain('status: 404');
  });

  it("only exports PAID transactions and sends no-store + attachment headers", () => {
    expect(route).toContain('.eq("status", "PAID")');
    expect(route).toContain("no-store");
    expect(route).toContain("attachment");
  });
});

describe("C2 sweeper — static guards", () => {
  it("the sweeper service never creates a transaction and settles only through verifyAndSettle", () => {
    const src = read("services/payment-sweeper.ts");
    expect(src).toContain("verifyAndSettle(");
    expect(src).not.toMatch(/\.(insert|upsert|delete)\(|\.rpc\(/);
    expect(src).not.toContain("fn_apply_verified_payment");
    expect(src).not.toMatch(/console\./);
  });
  it("the sweeper endpoint is bearer-protected and the scheduled function carries no payment logic", () => {
    expect(read("app/api/internal/payments/sweep/route.ts")).toContain("isAuthorizedProcessorRequest(");
    const fn = read("netlify/functions/payment-pending-sweep.ts");
    expect(fn).toContain("export const config");
    expect(fn).not.toMatch(/midtrans|SUPABASE|serverEnv/i);
  });
});
