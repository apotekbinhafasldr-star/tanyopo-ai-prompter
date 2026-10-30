// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { holder, buckets } = vi.hoisted(() => ({
  holder: { operator: null as null | { userId: string; admin: unknown } },
  buckets: new Map<string, number>(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/services/payment-operator", () => ({ getPaymentOperator: async () => holder.operator }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (key: string, limit: number) => {
    const n = (buckets.get(key) ?? 0) + 1;
    buckets.set(key, n);
    return { allowed: n <= limit, limit, remaining: 0, resetAt: 0 };
  },
}));

import { ackAlertAction, resolveAlertAction, syncAlertsAction } from "@/app/ops/payments/actions";

const ID = "11111111-1111-4111-8111-111111111111";
const OP = "22222222-2222-4222-8222-222222222222";

function fakeAdmin(replies: Record<string, unknown>) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data: replies[name] ?? null, error: null };
    },
    from: () => {
      throw new Error("operator actions must not read or write tables directly");
    },
  };
}
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const redirectOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  return "NO_REDIRECT";
};

describe("Billing B4.1 — operator actions (/ops/payments)", () => {
  beforeEach(() => {
    buckets.clear();
    holder.operator = null;
  });

  it("an unauthenticated / non-operator caller is denied by every action and touches nothing", async () => {
    for (const run of [
      () => ackAlertAction(form({ alertId: ID })),
      () => resolveAlertAction(form({ alertId: ID, note: "catatan ok" })),
      () => syncAlertsAction(),
    ]) {
      expect(await redirectOf(run())).toBe("REDIRECT:/ops/payments?r=denied&ok=0");
    }
  });

  it("ACK calls only fn_ack_payment_alert with the operator's own id (the form cannot choose the actor)", async () => {
    const admin = fakeAdmin({ fn_ack_payment_alert: "ACKED" });
    holder.operator = { userId: OP, admin };
    const out = await redirectOf(ackAlertAction(form({ alertId: ID, note: "cek", operator: "99999999-9999-4999-8999-999999999999", actor: "x" })));
    expect(out).toBe("REDIRECT:/ops/payments?r=acked&ok=1");
    expect(admin.calls).toEqual([{ name: "fn_ack_payment_alert", args: { p_alert_id: ID, p_operator: OP, p_note: "cek" } }]);
  });

  it("RESOLVE requires a note and calls only fn_resolve_payment_alert", async () => {
    const admin = fakeAdmin({ fn_resolve_payment_alert: "RESOLVED" });
    holder.operator = { userId: OP, admin };
    expect(await redirectOf(resolveAlertAction(form({ alertId: ID, note: "ab" })))).toBe("REDIRECT:/ops/payments?r=note&ok=0");
    expect(admin.calls).toEqual([]);
    expect(await redirectOf(resolveAlertAction(form({ alertId: ID, note: "refund dikonfirmasi di dashboard" })))).toBe("REDIRECT:/ops/payments?r=resolved&ok=1");
    expect(admin.calls.map((c) => c.name)).toEqual(["fn_resolve_payment_alert"]);
  });

  it("a malformed alert id is rejected before any database call", async () => {
    const admin = fakeAdmin({});
    holder.operator = { userId: OP, admin };
    expect(await redirectOf(ackAlertAction(form({ alertId: "1' or '1'='1" })))).toBe("REDIRECT:/ops/payments?r=invalid&ok=0");
    expect(await redirectOf(resolveAlertAction(form({ note: "catatan ok" })))).toBe("REDIRECT:/ops/payments?r=invalid&ok=0");
    expect(admin.calls).toEqual([]);
  });

  it("a stale / refused database answer is reported as a failure, never as success", async () => {
    const admin = fakeAdmin({ fn_ack_payment_alert: "INVALID_STATE" });
    holder.operator = { userId: OP, admin };
    expect(await redirectOf(ackAlertAction(form({ alertId: ID })))).toBe("REDIRECT:/ops/payments?r=failed&ok=0");
  });

  it("sync action only calls the sync function, and is rate limited", async () => {
    const admin = fakeAdmin({ fn_sync_payment_alerts: [{ skipped: false, review_created: 0, alarm_created: 0, auto_resolved: 0 }] });
    holder.operator = { userId: OP, admin };
    expect(await redirectOf(syncAlertsAction())).toBe("REDIRECT:/ops/payments?r=synced&ok=1");
    expect(admin.calls.map((c) => c.name)).toEqual(["fn_sync_payment_alerts"]);
    for (let i = 0; i < 5; i++) await redirectOf(syncAlertsAction());
    expect(await redirectOf(syncAlertsAction())).toBe("REDIRECT:/ops/payments?r=rate&ok=0");
  });

  it("no action can reach activation, checkout, transaction or subscription functions", async () => {
    const admin = fakeAdmin({ fn_ack_payment_alert: "ACKED", fn_resolve_payment_alert: "RESOLVED", fn_sync_payment_alerts: [{ skipped: false, review_created: 0, alarm_created: 0, auto_resolved: 0 }] });
    holder.operator = { userId: OP, admin };
    await redirectOf(ackAlertAction(form({ alertId: ID })));
    await redirectOf(resolveAlertAction(form({ alertId: ID, note: "catatan ok" })));
    await redirectOf(syncAlertsAction());
    for (const c of admin.calls) expect(c.name).toMatch(/^fn_(ack|resolve|sync)_payment_alerts?$/);
  });
});
