import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getOrCreateSubscription, SubscriptionUnavailableError, TRIAL_DURATION_DAYS } from "@/services/billing";

/**
 * F1 at CODE / UNIT level (mock client, no database): when the subscription row cannot be read or stored,
 * getOrCreateSubscription must fail closed and never hand out a trial that exists only in application memory.
 * Says nothing about what production does (still UNKNOWN until a dated read-only check).
 */

type Subscription = Database["public"]["Tables"]["prompter_subscriptions"]["Row"];
type DbError = { code: string; message: string };

const TENANT = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-11-15T10:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;

function row(): Subscription {
  return {
    tenant_id: TENANT,
    plan: "FREE",
    status: "TRIALING",
    billing_provider: null,
    success_fee_rate_bps: null,
    current_period_start: NOW,
    current_period_end: new Date(Date.parse(NOW) + TRIAL_DURATION_DAYS * DAY_MS).toISOString(),
    billing_country: null,
    invoice_currency: null,
    payment_provider_customer_reference: null,
    tax_metadata: {},
    cancel_at_period_end: false,
    provider_subscription_id: null,
    created_at: NOW,
    updated_at: NOW,
  };
}

interface Options {
  reads: Array<{ data: Subscription | null; error: DbError | null }>;
  insert?: { data: Subscription | null; error: DbError | null };
}

function fakeClient(options: Options) {
  let readIndex = 0;
  const inserts: unknown[] = [];
  const readChain = {
    eq: () => readChain,
    maybeSingle: async () => {
      const result = options.reads[Math.min(readIndex, options.reads.length - 1)];
      readIndex += 1;
      return result;
    },
  };
  const table = {
    select: () => readChain,
    insert: (payload: unknown) => {
      inserts.push(payload);
      return { select: () => ({ single: async () => options.insert ?? { data: null, error: null } }) };
    },
  };
  const client = { from: () => table } as unknown as SupabaseClient<Database>;
  return { client, inserts };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getOrCreateSubscription fails closed (F1)", () => {
  it("throws when reading the row fails, and does not insert a trial", async () => {
    const fake = fakeClient({ reads: [{ data: null, error: { code: "42501", message: "denied" } }] });

    await expect(getOrCreateSubscription(fake.client, TENANT)).rejects.toBeInstanceOf(SubscriptionUnavailableError);
    expect(fake.inserts).toHaveLength(0);
  });

  it("throws, instead of returning an invented trial, when the insert fails", async () => {
    const fake = fakeClient({
      reads: [{ data: null, error: null }],
      insert: { data: null, error: { code: "42501", message: "row-level security" } },
    });

    await expect(getOrCreateSubscription(fake.client, TENANT)).rejects.toBeInstanceOf(SubscriptionUnavailableError);
    expect(fake.inserts).toHaveLength(1);
  });

  it("throws when the insert returns neither a row nor an error", async () => {
    const fake = fakeClient({ reads: [{ data: null, error: null }], insert: { data: null, error: null } });

    await expect(getOrCreateSubscription(fake.client, TENANT)).rejects.toBeInstanceOf(SubscriptionUnavailableError);
  });

  it("does not leak database details in the error message", async () => {
    const fake = fakeClient({
      reads: [{ data: null, error: null }],
      insert: { data: null, error: { code: "42501", message: "new row violates row-level security policy" } },
    });

    const error = await getOrCreateSubscription(fake.client, TENANT).catch((e: unknown) => e);

    expect(String((error as Error).message)).not.toMatch(/42501|row-level|policy/);
  });

  it("returns the stored winner row on a concurrent first access (unique violation)", async () => {
    const winner = row();
    const fake = fakeClient({
      reads: [
        { data: null, error: null },
        { data: winner, error: null },
      ],
      insert: { data: null, error: { code: "23505", message: "duplicate key" } },
    });

    expect(await getOrCreateSubscription(fake.client, TENANT)).toBe(winner);
  });

  it("throws when a unique violation is followed by a re-read that finds nothing", async () => {
    const fake = fakeClient({
      reads: [{ data: null, error: null }],
      insert: { data: null, error: { code: "23505", message: "duplicate key" } },
    });

    await expect(getOrCreateSubscription(fake.client, TENANT)).rejects.toBeInstanceOf(SubscriptionUnavailableError);
  });

  it("still returns the stored row on a normal first access (one 14-day trial)", async () => {
    const stored = row();
    const fake = fakeClient({ reads: [{ data: null, error: null }], insert: { data: stored, error: null } });

    expect(await getOrCreateSubscription(fake.client, TENANT)).toBe(stored);
    expect(fake.inserts).toHaveLength(1);
    const payload = fake.inserts[0] as Record<string, string>;
    expect(Date.parse(payload.current_period_end) - Date.parse(payload.current_period_start)).toBe(TRIAL_DURATION_DAYS * DAY_MS);
  });
});
