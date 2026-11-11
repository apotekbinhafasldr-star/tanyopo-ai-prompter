import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { sessionMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(async () => ({ tenantId: "tenant-1", userId: "user-1", role: "owner" })),
}));
vi.mock("@/services/session", () => ({ requireSessionContext: sessionMock }));

// The AI job is stubbed to stop right after the reads: this file only tests which rows the action asks for.
const { runAiJobMock } = vi.hoisted(() => ({ runAiJobMock: vi.fn(async () => ({ ok: false as const, error: "ai-stop" })) }));
vi.mock("@/services/ai-jobs", () => ({ runAiJob: runAiJobMock }));
vi.mock("@/lib/ai/prompts", () => ({
  buildSystemPreamble: () => "system",
  buildOptimizationRecommendationPrompt: () => "prompt",
}));
vi.mock("@/services/budget-guard", () => ({
  getOrCreateBudgetPolicy: vi.fn(),
  getMonthToDateSpend: vi.fn(),
}));

type Filter = ["eq" | "in", string, unknown];
const log: { table: string; filters: Filter[] }[] = [];

function makeBuilder(table: string, result: unknown) {
  const filters: Filter[] = [];
  log.push({ table, filters });
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "order", "limit"]) builder[method] = () => builder;
  builder.eq = (column: string, value: unknown) => {
    filters.push(["eq", column, value]);
    return builder;
  };
  builder.in = (column: string, value: unknown) => {
    filters.push(["in", column, value]);
    return builder;
  };
  builder.single = async () => result;
  builder.maybeSingle = async () => result;
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

const RESULTS: Record<string, unknown> = {
  prompter_master_campaigns: { data: { id: "mc1", name: "Promo", product_id: "p1", daily_budget: 100000 }, error: null },
  prompter_channel_campaigns: {
    data: [{ id: "cc1", channel: "FACEBOOK", status: "ACTIVE", budget_percentage: 100 }],
    error: null,
  },
  prompter_marketing_metrics: { data: [{ channel_campaign_id: "cc1", spend: 100 }], error: null },
  prompter_conversions: { data: [], error: null },
  prompter_products: { data: { hpp: 10 }, error: null },
  prompter_brand_profiles: { data: null, error: null },
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => {
      if (!(table in RESULTS)) throw new Error(`Unexpected table: ${table}`);
      return makeBuilder(table, RESULTS[table]);
    },
  })),
}));

import { generateOptimizationRecommendationsAction } from "@/features/campaigns/optimization-actions";

const readsOf = (table: string) => log.filter((entry) => entry.table === table);
const hasTenantFilter = (entry: { filters: Filter[] }) =>
  entry.filters.some(([kind, column, value]) => kind === "eq" && column === "tenant_id" && value === "tenant-1");

describe("generateOptimizationRecommendationsAction — tenant filter on every read (defense in depth)", () => {
  beforeEach(() => {
    log.length = 0;
    runAiJobMock.mockClear();
    sessionMock.mockResolvedValue({ tenantId: "tenant-1", userId: "user-1", role: "owner" });
  });

  it.each(["prompter_master_campaigns", "prompter_channel_campaigns", "prompter_marketing_metrics", "prompter_conversions", "prompter_products"])(
    "%s is read with .eq('tenant_id', <session tenant>)",
    async (table) => {
      const result = await generateOptimizationRecommendationsAction("mc1");
      expect(result).toEqual({ error: "ai-stop" });
      const reads = readsOf(table);
      expect(reads.length, table).toBeGreaterThan(0);
      for (const read of reads) expect(hasTenantFilter(read), `${table}: ${JSON.stringify(read.filters)}`).toBe(true);
    },
  );

  it("the metrics and conversions reads still filter by the channel campaign ids and the PURCHASE event", async () => {
    await generateOptimizationRecommendationsAction("mc1");
    const metrics = readsOf("prompter_marketing_metrics")[0];
    expect(metrics.filters).toContainEqual(["in", "channel_campaign_id", ["cc1"]]);
    const conversions = readsOf("prompter_conversions")[0];
    expect(conversions.filters).toContainEqual(["in", "channel_campaign_id", ["cc1"]]);
    expect(conversions.filters).toContainEqual(["eq", "event_type", "PURCHASE"]);
  });

  it("the channel read is still scoped to the master campaign as well as the tenant", async () => {
    await generateOptimizationRecommendationsAction("mc1");
    const channels = readsOf("prompter_channel_campaigns")[0];
    expect(channels.filters).toContainEqual(["eq", "master_campaign_id", "mc1"]);
    expect(channels.filters).toContainEqual(["eq", "tenant_id", "tenant-1"]);
  });

  it("a role without permission reads nothing", async () => {
    sessionMock.mockResolvedValue({ tenantId: "tenant-1", userId: "user-1", role: "viewer" });
    const result = await generateOptimizationRecommendationsAction("mc1");
    expect(result.error).toMatch(/tidak memiliki izin/);
    expect(log).toHaveLength(0);
    expect(runAiJobMock).not.toHaveBeenCalled();
  });
});
