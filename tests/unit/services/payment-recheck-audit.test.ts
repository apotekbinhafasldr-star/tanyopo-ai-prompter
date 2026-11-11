// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { PaymentProvider, VerifiedPayment } from "@/lib/billing/payment-provider";
import { recheckPendingPayment } from "@/services/payment-recheck";
import { TENANT_A, TXN_A, addTxn, createFakeDb, type FakeDb } from "../support/payment-fakes";

// Audit pelengkap PR #125: balapan dengan webhook/klik ganda, status gateway aneh, dan tidak ada kebocoran detail.
const OP = "99999999-9999-4999-8999-999999999999";
const NOW = Date.parse("2026-11-11T12:00:00.000Z");
const OLD = new Date(NOW - 30 * 60_000).toISOString();

let db: FakeDb;
const admin = () => db as unknown as SupabaseClient<Database>;

function paid(over: Partial<VerifiedPayment> = {}): VerifiedPayment {
  return { orderId: TXN_A, gatewayTransactionId: "orig-req-1", status: "PAID", amount: 99000, currency: "IDR", rawStatus: "SUCCESS/-/-", ...over };
}
function providerOf(answer: () => Promise<VerifiedPayment> | VerifiedPayment) {
  const get = vi.fn(async () => answer());
  return { provider: { name: "doku", isConfigured: () => true, getVerifiedPayment: get } as unknown as PaymentProvider, get };
}

beforeEach(() => {
  db = createFakeDb();
  addTxn(db, { provider: "doku", created_at: OLD });
});

describe("recheck: balapan dan idempotensi", () => {
  it("webhook menang di tengah jalan: operator tidak menambah periode kedua", async () => {
    const { provider } = providerOf(() => {
      // Webhook/sweeper memproses transaksi yang sama setelah operator lolos cek kelayakan, sebelum RPC operator jalan.
      db.txns[0].status = "PAID";
      db.periods[TENANT_A] = 1;
      return paid();
    });
    const res = await recheckPendingPayment(admin(), provider, TXN_A, OP, NOW);
    expect(res.ok).toBe(true);
    expect(db.periods).toEqual({ [TENANT_A]: 1 });
    expect(db.txns[0].status).toBe("PAID");
  });

  it("dua klik bersamaan: paling banyak satu periode", async () => {
    const { provider } = providerOf(() => paid());
    await Promise.all([
      recheckPendingPayment(admin(), provider, TXN_A, OP, NOW),
      recheckPendingPayment(admin(), provider, TXN_A, OP, NOW),
    ]);
    expect(db.periods).toEqual({ [TENANT_A]: 1 });
    expect(db.txns[0].status).toBe("PAID");
  });

  it("transaksi berubah jadi EXPIRED saat verifikasi lalu gateway menjawab LUNAS: masuk REVIEW, tidak aktif", async () => {
    const { provider } = providerOf(() => {
      db.txns[0].status = "EXPIRED";
      return paid();
    });
    const res = await recheckPendingPayment(admin(), provider, TXN_A, OP, NOW);
    expect(res).toEqual({ ok: true, code: "review" });
    expect(db.periods).toEqual({});
    expect(db.txns[0].status).toBe("REVIEW");
  });
});

describe("recheck: status gateway aneh tidak mengubah status pembayaran", () => {
  it.each(["paid", "SETTLED", "SUCCESS", "", "UNKNOWN", "PENDING"])("status mentah %j bukan PAID resmi: tidak aktif, tetap PENDING", async (status) => {
    const { provider } = providerOf(() => paid({ status: status as VerifiedPayment["status"] }));
    const res = await recheckPendingPayment(admin(), provider, TXN_A, OP, NOW);
    expect(res.ok).toBe(true);
    expect(db.txns[0].status).toBe("PENDING");
    expect(db.periods).toEqual({});
    expect(db.rpcCalls).toEqual([]);
  });

  it.each(["REFUNDED", "CHARGEBACK"] as const)("%s: hanya alarm, status transaksi dan langganan tidak berubah", async (status) => {
    const { provider } = providerOf(() => paid({ status, rawStatus: `${status}/-/-` }));
    expect(await recheckPendingPayment(admin(), provider, TXN_A, OP, NOW)).toEqual({ ok: true, code: "alarm" });
    expect(db.txns[0].status).toBe("PENDING");
    expect(db.periods).toEqual({});
    expect(db.rpcCalls.every((c) => c.name === "fn_record_payment_alarm")).toBe(true);
  });

  it("LUNAS tanpa referensi pembayaran gateway ditolak (unverifiable), tidak memanggil RPC aktivasi", async () => {
    const { provider } = providerOf(() => paid({ gatewayTransactionId: null }));
    expect(await recheckPendingPayment(admin(), provider, TXN_A, OP, NOW)).toEqual({ ok: false, code: "unverifiable" });
    expect(db.rpcCalls).toEqual([]);
    expect(db.txns[0].status).toBe("PENDING");
  });

  it("LUNAS dengan mata uang bukan IDR dari gateway: transaksi IDR masuk REVIEW, tidak aktif (B-CUR tetap fail-closed)", async () => {
    const { provider } = providerOf(() => paid({ currency: "USD" }));
    expect(await recheckPendingPayment(admin(), provider, TXN_A, OP, NOW)).toEqual({ ok: true, code: "review" });
    expect(db.periods).toEqual({});
  });
});

describe("recheck: kegagalan gateway tidak membocorkan detail", () => {
  const SECRET = "Bearer sk-live-SECRET-12345 client-secret";

  it.each([
    ["Error biasa berisi rahasia", () => { throw new Error(SECRET); }],
    ["timeout", () => { throw new DOMException("The operation timed out", "TimeoutError"); }],
    ["bukan Error", () => Promise.reject(SECRET)],
  ])("%s -> unverifiable, status tetap, hasil dan audit tanpa teks gateway", async (_label, answer) => {
    const { provider } = providerOf(answer as () => Promise<VerifiedPayment>);
    const res = await recheckPendingPayment(admin(), provider, TXN_A, OP, NOW);
    expect(res).toEqual({ ok: false, code: "unverifiable" });
    expect(db.txns[0].status).toBe("PENDING");
    expect(db.periods).toEqual({});
    expect(JSON.stringify([res, db.audit])).not.toContain("SECRET");
    expect(db.audit.at(-1)?.context).toEqual({ result: "unverifiable" });
  });
});

describe("recheck: tidak ada perubahan flag/env/proxy", () => {
  it("file tugas tidak menyentuh PAYMENT_LIVE_ENABLED, process.env, atau jalur aktivasi langsung", () => {
    for (const rel of ["services/payment-recheck.ts", "services/payment-health.ts", "app/ops/payments/recheck-actions.ts", "lib/billing/webhook-markers.ts"]) {
      const src = readFileSync(path.join(process.cwd(), rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(src, rel).not.toMatch(/PAYMENT_LIVE_ENABLED|process\.env|fn_apply_verified_payment/);
    }
  });
});
