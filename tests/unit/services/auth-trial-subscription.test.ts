import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getOrCreateSubscription, TRIAL_DURATION_DAYS } from "@/services/billing";

/**
 * Trial creation (getOrCreateSubscription) at CODE / UNIT level, with a fake query builder. Nothing here talks to a
 * database, so none of it proves what production does: that stays UNKNOWN until a dated read-only check
 * (see docs/S1_STATUS_EVIDENCE.md). Tests marked KNOWN GAP use `it.fails`: they state the behaviour we want, they pass
 * while the gap exists, and they turn red the day the gap is fixed so the marker is converted into a normal `it`.
 */

type Subscription = Database["public"]["Tables"]["prompter_subscriptions"]["Row"];
type DbError = { code: string; message: string };

const TENANT = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-11-11T10:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;

function subscriptionRow(overrides: Partial<Subscription> = {}): Subscription {
  return {
    tenant_id: TENANT,
    plan: "FREE",
    status: "TRIALING",
    billing_provider: null,
    success_fee_rate_bps: null,
    current_period_start: NOW,
    current_period_end: new Date(Date.parse(NOW) + 14 * DAY_MS).toISOString(),
    billing_country: null,
    invoice_currency: null,
    payment_provider_customer_reference: null,
    tax_metadata: {},
    cancel_at_period_end: false,
    provider_subscription_id: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

interface FakeOptions {
  /** What successive maybeSingle() reads return; the last entry repeats. */
  reads: Array<Subscription | null>;
  /** What the insert(...).select().single() chain resolves to. */
  insert?: { data: Subscription | null; error: DbError | null };
}

interface ReadChain {
  eq: (column: string, value: unknown) => ReadChain;
  maybeSingle: () => Promise<{ data: Subscription | null; error: null }>;
}

function fakeClient(options: FakeOptions) {
  const inserts: unknown[] = [];
  const filters: Array<[string, unknown]> = [];
  const tables: string[] = [];
  const forbiddenWrites = { update: 0, delete: 0, upsert: 0 };
  let readIndex = 0;

  const readChain: ReadChain = {
    eq: vi.fn((column: string, value: unknown) => {
      filters.push([column, value]);
      return readChain;
    }),
    maybeSingle: vi.fn(async () => {
      const data = options.reads[Math.min(readIndex, options.reads.length - 1)];
      readIndex += 1;
      return { data, error: null };
    }),
  };

  const table = {
    select: vi.fn(() => readChain),
    insert: vi.fn((row: unknown) => {
      inserts.push(row);
      return { select: () => ({ single: async () => options.insert ?? { data: null, error: null } }) };
    }),
    update: vi.fn(() => {
      forbiddenWrites.update += 1;
      return readChain;
    }),
    delete: vi.fn(() => {
      forbiddenWrites.delete += 1;
      return readChain;
    }),
    upsert: vi.fn(() => {
      forbiddenWrites.upsert += 1;
      return readChain;
    }),
  };

  const client = {
    from: vi.fn((name: string) => {
      tables.push(name);
      return table;
    }),
  } as unknown as SupabaseClient<Database>;

  return { client, inserts, filters, tables, forbiddenWrites };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getOrCreateSubscription: existing row (CODE/UNIT)", () => {
  it("returns an existing row untouched and never inserts a second trial", async () => {
    const existing = subscriptionRow({ current_period_start: "2026-10-01T00:00:00.000Z", current_period_end: "2026-10-15T00:00:00.000Z" });
    const fake = fakeClient({ reads: [existing] });

    const result = await getOrCreateSubscription(fake.client, TENANT);

    expect(result).toBe(existing);
    expect(fake.inserts).toHaveLength(0);
  });

  it("leaves a legacy ACTIVE row without a period alone (no retroactive trial)", async () => {
    const legacy = subscriptionRow({ status: "ACTIVE", current_period_start: null, current_period_end: null });
    const fake = fakeClient({ reads: [legacy] });

    expect(await getOrCreateSubscription(fake.client, TENANT)).toBe(legacy);
    expect(fake.inserts).toHaveLength(0);
  });

  it("is idempotent: repeated calls on an existing row create nothing", async () => {
    const fake = fakeClient({ reads: [subscriptionRow()] });

    await getOrCreateSubscription(fake.client, TENANT);
    await getOrCreateSubscription(fake.client, TENANT);
    await getOrCreateSubscription(fake.client, TENANT);

    expect(fake.inserts).toHaveLength(0);
  });

  it("reads the row of the requested tenant only", async () => {
    const fake = fakeClient({ reads: [subscriptionRow()] });

    await getOrCreateSubscription(fake.client, TENANT);

    expect(fake.tables).toEqual(["prompter_subscriptions"]);
    expect(fake.filters).toContainEqual(["tenant_id", TENANT]);
  });
});

describe("getOrCreateSubscription: first access (CODE/UNIT)", () => {
  it("inserts exactly one canonical trial: tenant, TRIALING, now, now + 14 days, and nothing else", async () => {
    const created = subscriptionRow();
    const fake = fakeClient({ reads: [null], insert: { data: created, error: null } });

    await getOrCreateSubscription(fake.client, TENANT);

    expect(fake.inserts).toHaveLength(1);
    const payload = fake.inserts[0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["current_period_end", "current_period_start", "status", "tenant_id"]);
    expect(payload.tenant_id).toBe(TENANT);
    expect(payload.status).toBe("TRIALING");
    expect(payload.current_period_start).toBe(NOW);
    expect(Date.parse(String(payload.current_period_end)) - Date.parse(String(payload.current_period_start))).toBe(
      TRIAL_DURATION_DAYS * DAY_MS,
    );
  });

  it("never sends plan, billing or provider fields from the client", async () => {
    const fake = fakeClient({ reads: [null], insert: { data: subscriptionRow(), error: null } });

    await getOrCreateSubscription(fake.client, TENANT);

    const payload = fake.inserts[0] as Record<string, unknown>;
    for (const key of ["plan", "billing_provider", "payment_provider_customer_reference", "provider_subscription_id", "success_fee_rate_bps", "cancel_at_period_end", "created_at"]) {
      expect(payload).not.toHaveProperty(key);
    }
  });

  it("returns the stored row, not the application clock, when the database (trigger) set the period itself", async () => {
    const stored = subscriptionRow({
      current_period_start: "2026-11-11T10:00:00.250Z",
      current_period_end: "2026-11-25T10:00:00.250Z",
    });
    const fake = fakeClient({ reads: [null], insert: { data: stored, error: null } });

    expect(await getOrCreateSubscription(fake.client, TENANT)).toBe(stored);
  });

  it("is a 14-day trial", () => {
    expect(TRIAL_DURATION_DAYS).toBe(14);
  });

  it("never updates, deletes or upserts the subscription table, on any path", async () => {
    const paths: FakeOptions[] = [
      { reads: [subscriptionRow()] },
      { reads: [null], insert: { data: subscriptionRow(), error: null } },
      { reads: [null], insert: { data: null, error: { code: "23505", message: "duplicate key" } } },
      { reads: [null], insert: { data: null, error: { code: "42501", message: "rls" } } },
    ];

    for (const options of paths) {
      const fake = fakeClient(options);
      await getOrCreateSubscription(fake.client, TENANT);
      expect(fake.forbiddenWrites).toEqual({ update: 0, delete: 0, upsert: 0 });
    }
  });
});

describe("getOrCreateSubscription: insert did not succeed (KNOWN GAP, CODE)", () => {
  // Today a failed insert is ignored and a trial row that was never stored is returned (period = application clock,
  // 14 days from now). Two ways to hit it: a concurrent first access (the loser gets a primary-key conflict on
  // tenant_id) and any other insert error (RLS, outage). The billing page then shows a trial that does not match the
  // database, and a retry shows a fresh 14 days again. Fix needs services/billing.ts (forbidden for this task):
  // see docs/S1_STATUS_EVIDENCE.md section "Rancangan perbaikan".

  it.fails("KNOWN GAP: after a primary-key conflict (concurrent first access) it returns the row that won, not a made-up period", async () => {
    const winner = subscriptionRow({
      current_period_start: "2026-11-11T09:59:59.000Z",
      current_period_end: "2026-11-25T09:59:59.000Z",
    });
    const fake = fakeClient({
      reads: [null, winner],
      insert: { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } },
    });

    const result = await getOrCreateSubscription(fake.client, TENANT);

    expect(result.current_period_end).toBe(winner.current_period_end);
  });

  it.fails("KNOWN GAP: when nothing could be stored it does not hand out a TRIALING row with a period that exists nowhere", async () => {
    const fake = fakeClient({
      reads: [null],
      insert: { data: null, error: { code: "42501", message: "new row violates row-level security policy" } },
    });

    let fabricated = false;
    try {
      const result = await getOrCreateSubscription(fake.client, TENANT);
      fabricated = result.status === "TRIALING" && result.current_period_end !== null;
    } catch {
      fabricated = false; // refusing loudly is an acceptable outcome
    }

    expect(fabricated).toBe(false);
  });
});

describe("only one app code path creates a trial (CODE, static)", () => {
  const root = path.resolve(__dirname, "../../..");
  const SCAN_DIRS = ["app", "features", "lib", "services", "components"];

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
      else if (/\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
  }

  const writers: Array<{ file: string; ops: string[] }> = [];
  for (const dir of SCAN_DIRS) {
    for (const file of sourceFiles(path.join(root, dir))) {
      const text = readFileSync(file, "utf-8");
      const re = /\.from\(\s*"prompter_subscriptions"\s*\)/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(text))) {
        const rest = text.slice(match.index);
        const end = rest.indexOf(";");
        const chain = end < 0 ? rest : rest.slice(0, end);
        const ops = [...chain.matchAll(/\.(insert|upsert|update|delete)\(/g)].map((m) => m[1]);
        if (ops.length) writers.push({ file: path.relative(root, file).split(path.sep).join("/"), ops });
      }
    }
  }

  it("only services/billing.ts writes prompter_subscriptions through a client, and only with one insert", () => {
    expect(writers).toEqual([{ file: "services/billing.ts", ops: ["insert"] }]);
  });
});
