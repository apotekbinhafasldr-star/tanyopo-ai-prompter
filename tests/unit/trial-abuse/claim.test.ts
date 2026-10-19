import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { claimTrial } from "@/lib/trial-abuse/claim";
import { getOrCreateSubscription } from "@/services/billing";
import { readTrialAbuseConfig } from "@/lib/trial-abuse/config";

const SECRET = Buffer.alloc(32, 5).toString("base64");
const enforce = readTrialAbuseConfig({ TRIAL_ABUSE_MODE: "enforce", TRIAL_ABUSE_HMAC_SECRET: SECRET });
const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const ctx = async () => ({ ip: "203.0.113.50", cookie: "A".repeat(43) });

/* eslint-disable @typescript-eslint/no-explicit-any */
function fakeSupabase(opts: { user?: { id: string; email?: string } | null; profileTenant?: string | null; subscription?: unknown | null }) {
  const inserts: unknown[] = [];
  const client: any = {
    auth: { getUser: async () => ({ data: { user: opts.user === undefined ? { id: USER, email: "Budi@Example.com" } : opts.user } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            table === "user_profiles"
              ? { data: opts.profileTenant === null ? null : { tenant_id: opts.profileTenant ?? TENANT } }
              : { data: opts.subscription ?? null },
        }),
      }),
      insert: (row: unknown) => {
        inserts.push(row);
        return { select: () => ({ single: async () => ({ data: { ...(row as object), tenant_id: TENANT } }) }) };
      },
    }),
  };
  return { client, inserts };
}
function fakeAdmin(row: unknown, error: { code?: string } | null = null) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const admin: any = { rpc: async (fn: string, args: Record<string, unknown>) => (calls.push({ fn, args }), { data: row === undefined ? null : [row], error }) };
  return { admin, calls };
}

describe("claimTrial", () => {
  it("is a no-op unless mode is enforce (off and shadow keep the legacy path)", async () => {
    const { client } = fakeSupabase({});
    const { admin, calls } = fakeAdmin({ outcome: "CREATED" });
    for (const mode of ["", "off", "shadow"]) {
      const config = readTrialAbuseConfig({ TRIAL_ABUSE_MODE: mode, TRIAL_ABUSE_HMAC_SECRET: SECRET });
      expect(await claimTrial(client, TENANT, { config, admin, requestContext: ctx })).toBe("SKIPPED");
    }
    expect(calls).toHaveLength(0);
  });

  it("sends the verified user id and digests only (no raw email, IP or cookie)", async () => {
    const { client } = fakeSupabase({});
    const { admin, calls } = fakeAdmin({ outcome: "CREATED", decision: "ALLOW", retry_after_seconds: 0 });
    expect(await claimTrial(client, TENANT, { config: enforce, admin, requestContext: ctx })).toBe("CREATED");
    const a = calls[0].args;
    expect(calls[0].fn).toBe("fn_trial_claim");
    expect(a.p_user_id).toBe(USER);
    expect(a.p_mode).toBe("enforce");
    const text = JSON.stringify(a);
    for (const raw of ["budi", "example.com", "203.0.113", "AAAAAAAA"]) expect(text).not.toContain(raw);
    for (const k of ["p_email_hmac", "p_cookie_hmac", "p_ip_hmac"]) expect(String(a[k])).toMatch(/^[0-9a-f]{64}$/);
    expect(a.p_device_hmac).toBeNull();
  });

  it("maps database outcomes and treats everything else as UNAVAILABLE", async () => {
    const { client } = fakeSupabase({});
    for (const outcome of ["CREATED", "HELD", "EXISTS", "RATE_LIMITED"] as const) {
      expect(await claimTrial(client, TENANT, { config: enforce, admin: fakeAdmin({ outcome }).admin, requestContext: ctx })).toBe(outcome);
    }
    expect(await claimTrial(client, TENANT, { config: enforce, admin: fakeAdmin({ outcome: "NO_TENANT" }).admin, requestContext: ctx })).toBe("UNAVAILABLE");
    expect(await claimTrial(client, TENANT, { config: enforce, admin: fakeAdmin(undefined).admin, requestContext: ctx })).toBe("UNAVAILABLE");
  });

  it("FAILS CLOSED: rpc error, missing admin, missing secret, invalid mode, no user, foreign tenant", async () => {
    const ok = fakeSupabase({}).client;
    expect(await claimTrial(ok, TENANT, { config: enforce, admin: fakeAdmin({ outcome: "CREATED" }, { code: "XX000" }).admin, requestContext: ctx })).toBe("UNAVAILABLE");
    expect(await claimTrial(ok, TENANT, { config: enforce, admin: null, requestContext: ctx })).toBe("UNAVAILABLE");
    expect(await claimTrial(ok, TENANT, { config: readTrialAbuseConfig({ TRIAL_ABUSE_MODE: "enforce" }), admin: fakeAdmin({ outcome: "CREATED" }).admin, requestContext: ctx })).toBe("UNAVAILABLE");
    expect(await claimTrial(ok, TENANT, { config: readTrialAbuseConfig({ TRIAL_ABUSE_MODE: "enforec", TRIAL_ABUSE_HMAC_SECRET: SECRET }), admin: fakeAdmin({ outcome: "CREATED" }).admin, requestContext: ctx })).toBe("UNAVAILABLE");
    expect(await claimTrial(fakeSupabase({ user: null }).client, TENANT, { config: enforce, admin: fakeAdmin({ outcome: "CREATED" }).admin, requestContext: ctx })).toBe("UNAVAILABLE");
    expect(await claimTrial(fakeSupabase({ user: { id: USER } }).client, TENANT, { config: enforce, admin: fakeAdmin({ outcome: "CREATED" }).admin, requestContext: ctx })).toBe("UNAVAILABLE");
    const other = fakeAdmin({ outcome: "CREATED" });
    expect(await claimTrial(fakeSupabase({ profileTenant: "99999999-9999-9999-9999-999999999999" }).client, TENANT, { config: enforce, admin: other.admin, requestContext: ctx })).toBe("UNAVAILABLE");
    expect(other.calls).toHaveLength(0); // a tenant that is not the caller's own never reaches the database
  });
});

describe("getOrCreateSubscription with the claim gate", () => {
  const saved = { m: process.env.TRIAL_ABUSE_MODE, s: process.env.TRIAL_ABUSE_HMAC_SECRET, k: process.env.SUPABASE_SECRET_KEY };
  afterEach(() => {
    for (const [k, v] of [["TRIAL_ABUSE_MODE", saved.m], ["TRIAL_ABUSE_HMAC_SECRET", saved.s], ["SUPABASE_SECRET_KEY", saved.k]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("OFF (default): legacy client insert, identical to before", async () => {
    delete process.env.TRIAL_ABUSE_MODE;
    const { client, inserts } = fakeSupabase({});
    const sub = await getOrCreateSubscription(client, TENANT);
    expect(inserts).toHaveLength(1);
    expect(sub.status).toBe("TRIALING");
    expect(new Date(sub.current_period_end!).getTime()).toBeGreaterThan(Date.now() + 13 * 86400_000);
  });

  it("ENFORCE without a working gate: no client insert and an EXPIRED synthetic trial (fail closed)", async () => {
    process.env.TRIAL_ABUSE_MODE = "enforce";
    process.env.TRIAL_ABUSE_HMAC_SECRET = SECRET;
    delete process.env.SUPABASE_SECRET_KEY;
    const { client, inserts } = fakeSupabase({});
    const sub = await getOrCreateSubscription(client, TENANT);
    expect(inserts).toHaveLength(0);
    expect(new Date(sub.current_period_end!).getTime()).toBeLessThan(Date.now());
  });

  it("an invalid mode also never grants a trial", async () => {
    process.env.TRIAL_ABUSE_MODE = "enforec";
    const { client, inserts } = fakeSupabase({});
    const sub = await getOrCreateSubscription(client, TENANT);
    expect(inserts).toHaveLength(0);
    expect(new Date(sub.current_period_end!).getTime()).toBeLessThan(Date.now());
  });

  it("an existing subscription is returned untouched in every mode", async () => {
    process.env.TRIAL_ABUSE_MODE = "enforce";
    const existing = { tenant_id: TENANT, status: "ACTIVE", plan: "STARTER" };
    const { client, inserts } = fakeSupabase({ subscription: existing });
    expect(await getOrCreateSubscription(client, TENANT)).toEqual(existing);
    expect(inserts).toHaveLength(0);
  });

  it("the app never grants a trial on its own in enforce mode (static)", () => {
    const src = readFileSync(path.resolve(__dirname, "../../../services/billing.ts"), "utf-8");
    const fn = src.slice(src.indexOf("export async function getOrCreateSubscription"), src.indexOf("export interface TrialState"));
    expect(fn.indexOf("claimTrial(") < fn.indexOf(".insert(")).toBe(true);
    expect(fn).toMatch(/abuseMode === "enforce" \|\| abuseMode === "invalid"/);
  });
});
