// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  ackPaymentAlert,
  isPaymentOperator,
  recordPaymentAlarm,
  resolvePaymentAlert,
  syncIfStale,
  syncPaymentAlerts,
} from "@/services/payment-alerts";

const ID = "11111111-1111-4111-8111-111111111111";
const OP = "22222222-2222-4222-8222-222222222222";

type Reply = { data: unknown; error: { message: string } | null };
function admin(handlers: Record<string, (args: Record<string, unknown>) => Reply>, state?: Record<string, unknown> | null) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const h = handlers[name];
      if (!h) throw new Error(`unexpected rpc ${name}`);
      return h(args);
    }),
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state ?? null, error: null }) }) }),
    })),
  };
  return { client: client as unknown as SupabaseClient<Database>, calls };
}

describe("Billing B4.1 — payment alert service", () => {
  it("operator check never reaches the database for a malformed id and fails closed on error", async () => {
    const a = admin({ fn_is_payment_operator: () => ({ data: true, error: null }) });
    expect(await isPaymentOperator(a.client, "not-a-uuid")).toBe(false);
    expect(a.calls).toEqual([]);
    expect(await isPaymentOperator(a.client, OP)).toBe(true);
    const failing = admin({ fn_is_payment_operator: () => ({ data: null, error: { message: "x" } }) });
    expect(await isPaymentOperator(failing.client, OP)).toBe(false);
    const no = admin({ fn_is_payment_operator: () => ({ data: false, error: null }) });
    expect(await isPaymentOperator(no.client, OP)).toBe(false);
  });

  it("ack / resolve translate database outcomes; a non-operator is refused by the database answer", async () => {
    const a = admin({
      fn_ack_payment_alert: () => ({ data: "ACKED", error: null }),
      fn_resolve_payment_alert: (args) => ({ data: args.p_operator === OP ? "RESOLVED" : "NOT_OPERATOR", error: null }),
    });
    expect((await ackPaymentAlert(a.client, ID, OP, null)).ok).toBe(true);
    expect((await resolvePaymentAlert(a.client, ID, OP, "sudah dicek")).ok).toBe(true);
    expect(await resolvePaymentAlert(a.client, ID, ID, "sudah dicek")).toEqual({ ok: false, message: "Akses ditolak." });
  });

  it("ack / resolve with a malformed id or operator id never call the database", async () => {
    const a = admin({});
    expect((await ackPaymentAlert(a.client, "x", OP, null)).ok).toBe(false);
    expect((await resolvePaymentAlert(a.client, ID, "x", "catatan ok")).ok).toBe(false);
    expect(a.calls).toEqual([]);
  });

  it("a database error is never reported as success", async () => {
    const a = admin({ fn_ack_payment_alert: () => ({ data: null, error: { message: "boom" } }) });
    expect((await ackPaymentAlert(a.client, ID, OP, null)).ok).toBe(false);
  });

  it("sync success returns the counters; a failed run is recorded and does not throw", async () => {
    const ok = admin({ fn_sync_payment_alerts: () => ({ data: [{ skipped: false, review_created: 2, alarm_created: 1, auto_resolved: 0 }], error: null }) });
    expect(await syncPaymentAlerts(ok.client)).toEqual({ ok: true, skipped: false, reviewCreated: 2, alarmCreated: 1, autoResolved: 0 });

    const failing = admin({
      fn_sync_payment_alerts: () => ({ data: null, error: { message: "db down" } }),
      fn_note_payment_alert_sync_failure: () => ({ data: null, error: null }),
    });
    expect(await syncPaymentAlerts(failing.client)).toEqual({ ok: false, message: "db down" });
    expect(failing.calls.map((c) => c.name)).toEqual(["fn_sync_payment_alerts", "fn_note_payment_alert_sync_failure"]);
    expect(failing.calls[1].args).toEqual({ p_error: "db down" });
  });

  it("even if recording the failure also fails, the sync result is still a clean failure (alerts are re-derived next run)", async () => {
    const a = admin({
      fn_sync_payment_alerts: () => ({ data: null, error: { message: "db down" } }),
      fn_note_payment_alert_sync_failure: () => {
        throw new Error("still down");
      },
    });
    expect(await syncPaymentAlerts(a.client)).toEqual({ ok: false, message: "db down" });
  });

  it("lazy sync runs only when the last success is stale, and never throws", async () => {
    const fresh = admin({ fn_sync_payment_alerts: () => ({ data: [{ skipped: false, review_created: 0, alarm_created: 0, auto_resolved: 0 }], error: null }) }, { last_success_at: new Date().toISOString() });
    await syncIfStale(fresh.client);
    expect(fresh.calls).toEqual([]);
    const stale = admin({ fn_sync_payment_alerts: () => ({ data: [{ skipped: false, review_created: 0, alarm_created: 0, auto_resolved: 0 }], error: null }) }, { last_success_at: "2020-01-01T00:00:00Z" });
    await syncIfStale(stale.client);
    expect(stale.calls.map((c) => c.name)).toEqual(["fn_sync_payment_alerts"]);
    const broken = admin({ fn_sync_payment_alerts: () => { throw new Error("x"); } }, null);
    await expect(syncIfStale(broken.client)).resolves.toBeUndefined();
  });

  it("recordPaymentAlarm distinguishes CREATED / EXISTING and fails loudly otherwise", async () => {
    for (const outcome of ["CREATED", "EXISTING"] as const) {
      const a = admin({ fn_record_payment_alarm: () => ({ data: outcome, error: null }) });
      expect(await recordPaymentAlarm(a.client, ID, "REFUND", { a: 1 })).toEqual({ ok: true, outcome });
    }
    const missing = admin({ fn_record_payment_alarm: () => ({ data: "TRANSACTION_NOT_FOUND", error: null }) });
    expect((await recordPaymentAlarm(missing.client, ID, "REFUND", {})).ok).toBe(false);
    const err = admin({ fn_record_payment_alarm: () => ({ data: null, error: { message: "x" } }) });
    expect((await recordPaymentAlarm(err.client, ID, "CHARGEBACK", {})).ok).toBe(false);
  });
});
