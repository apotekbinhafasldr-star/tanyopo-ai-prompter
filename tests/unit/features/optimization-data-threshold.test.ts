import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { sessionMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(async () => ({ tenantId: "tenant-1", userId: "user-1", role: "owner" })),
}));
vi.mock("@/services/session", () => ({ requireSessionContext: sessionMock }));

const { runAiJobMock } = vi.hoisted(() => ({ runAiJobMock: vi.fn() }));
vi.mock("@/services/ai-jobs", () => ({ runAiJob: runAiJobMock }));
vi.mock("@/services/budget-guard", () => ({
  getOrCreateBudgetPolicy: vi.fn(),
  getMonthToDateSpend: vi.fn(),
}));

/**
 * Minimum-data gate of the OptimizationAgent (thresholds are PROPOSALS, UNVERIFIED):
 * below them no AI job is created (so no quota is used) and nothing is saved; a budget increase is never
 * recommended for a channel below the click threshold, whatever the model returned.
 */

type Row = Record<string, unknown>;
const state: {
  channels: Row[];
  metrics: Row[];
  upserts: Row[];
  inserts: { table: string; row: unknown }[];
} = { channels: [], metrics: [], upserts: [], inserts: [] };

function makeBuilder(table: string, result: () => unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "order", "limit", "eq", "in"]) builder[method] = () => builder;
  builder.single = async () => result();
  builder.maybeSingle = async () => result();
  builder.upsert = async (row: Row) => {
    state.upserts.push(row);
    return { error: null };
  };
  builder.insert = async (row: unknown) => {
    state.inserts.push({ table, row });
    return { error: null };
  };
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result()).then(resolve, reject);
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => {
      const results: Record<string, () => unknown> = {
        prompter_master_campaigns: () => ({ data: { id: "mc1", name: "Promo", product_id: "p1", daily_budget: 100000 }, error: null }),
        prompter_channel_campaigns: () => ({ data: state.channels, error: null }),
        prompter_marketing_metrics: () => ({ data: state.metrics, error: null }),
        prompter_conversions: () => ({ data: [], error: null }),
        prompter_products: () => ({ data: { hpp: 10 }, error: null }),
        prompter_brand_profiles: () => ({ data: null, error: null }),
        prompter_automation_settings: () => ({ data: null, error: null }),
        prompter_optimization_recommendations: () => ({ data: null, error: null }),
        prompter_audit_logs: () => ({ data: null, error: null }),
      };
      if (!(table in results)) throw new Error(`Unexpected table: ${table}`);
      return makeBuilder(table, results[table]);
    },
  })),
}));

import { generateOptimizationRecommendationsAction } from "@/features/campaigns/optimization-actions";

const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}`;
const metric = (channelCampaignId: string, d: number, over: Row = {}): Row => ({
  channel_campaign_id: channelCampaignId,
  spend: 10,
  impressions: 1500,
  clicks: 60,
  reach: 1200,
  date: day(d),
  ...over,
});

/** Three days with 4500 impressions and 180 clicks: meets every proposed threshold. */
const enoughRows = (channelCampaignId: string) => [1, 2, 3].map((d) => metric(channelCampaignId, d));

function aiReturns(recommendations: Row[]) {
  runAiJobMock.mockResolvedValue({
    ok: true,
    jobId: "job-1",
    model: "fake-model",
    data: { summary: "Ringkasan.", recommendations },
  });
}

const increase = (channel: string): Row => ({
  channel,
  action_type: "INCREASE_BUDGET",
  rationale: "Performa terlihat baik.",
  suggested_daily_budget: 150000,
  risk_level: "MEDIUM",
});

beforeEach(() => {
  runAiJobMock.mockReset();
  state.channels = [{ id: "cc1", channel: "FACEBOOK", status: "ACTIVE", budget_percentage: 100 }];
  state.metrics = enoughRows("cc1");
  state.upserts = [];
  state.inserts = [];
  sessionMock.mockResolvedValue({ tenantId: "tenant-1", userId: "user-1", role: "owner" });
});

describe("below the minimum data: no AI job, nothing saved, no quota used", () => {
  const cases: [string, Row[], RegExp][] = [
    ["only 1 day of data", [metric("cc1", 1, { impressions: 5000, clicks: 300 })], /1 dari minimal 3 hari/],
    ["only 2 days of data", [1, 2].map((d) => metric("cc1", d, { impressions: 5000, clicks: 300 })), /2 dari minimal 3 hari/],
    ["3 days but fewer than 1000 impressions", [1, 2, 3].map((d) => metric("cc1", d, { impressions: 300, clicks: 30 })), /900 dari minimal 1000 impresi/],
    ["rows without impressions at all", [1, 2, 3].map((d) => metric("cc1", d, { impressions: 0, clicks: 0 })), /0 dari minimal 3 hari/],
  ];

  it.each(cases)("%s", async (_label, rows, shortfall) => {
    state.metrics = rows;

    const result = await generateOptimizationRecommendationsAction("mc1");

    expect(result.error).toMatch(/Data belum cukup/);
    expect(result.error).toMatch(shortfall);
    expect(result.error).toMatch(/usulan, belum divalidasi/);
    expect(result.error).toMatch(/Tidak ada kuota AI yang dipakai/);
    expect(runAiJobMock).not.toHaveBeenCalled();
    expect(state.upserts).toEqual([]);
    expect(state.inserts).toEqual([]);
  });

  it("the existing 'no spend or conversion data at all' message still comes first", async () => {
    state.metrics = [];

    const result = await generateOptimizationRecommendationsAction("mc1");

    expect(result.error).toMatch(/Belum ada data spend atau konversi/);
    expect(runAiJobMock).not.toHaveBeenCalled();
  });

  it("a role without permission is still refused before anything is read", async () => {
    sessionMock.mockResolvedValue({ tenantId: "tenant-1", userId: "user-1", role: "viewer" });
    const result = await generateOptimizationRecommendationsAction("mc1");
    expect(result.error).toMatch(/tidak memiliki izin/);
    expect(runAiJobMock).not.toHaveBeenCalled();
  });
});

describe("with enough data: one AI job, rates computed in code and shown to the model", () => {
  it("passes impressions, clicks, reach and the CTR/CPC computed by the system into the prompt (one job only)", async () => {
    aiReturns([{ ...increase("FACEBOOK"), action_type: "NO_ACTION", suggested_daily_budget: null }]);

    const result = await generateOptimizationRecommendationsAction("mc1");

    expect(result.error).toBeNull();
    expect(runAiJobMock).toHaveBeenCalledTimes(1);
    const prompt: string = runAiJobMock.mock.calls[0][0].prompt;
    expect(prompt).toContain("4500 impresi");
    expect(prompt).toContain("180 klik");
    expect(prompt).toContain("3600 reach");
    expect(prompt).toContain("3 hari data");
    // 180 / 4500 * 100 = 4 ; spend 30 / 180 clicks = 0.17
    expect(prompt).toContain("CTR 4%");
    expect(prompt).toContain("CPC 0.17");
    expect(prompt).toMatch(/dihitung oleh sistem/);
    expect(prompt).toMatch(/data cukup untuk dianalisis/);
  });

  it("keeps a budget increase when the channel meets the click threshold too", async () => {
    aiReturns([increase("FACEBOOK")]);

    expect((await generateOptimizationRecommendationsAction("mc1")).error).toBeNull();

    const saved = state.upserts[0].recommendations as Row[];
    expect(saved[0]).toMatchObject({ action_type: "INCREASE_BUDGET", suggested_daily_budget: 150000 });
  });
});

describe("INCREASE_BUDGET is blocked below the click threshold, whatever the model said", () => {
  it("enough days and impressions but only 45 clicks: the saved recommendation is NO_ACTION with no budget", async () => {
    state.metrics = [1, 2, 3].map((d) => metric("cc1", d, { clicks: 15 }));
    aiReturns([increase("FACEBOOK")]);

    const result = await generateOptimizationRecommendationsAction("mc1");

    expect(result.error).toBeNull();
    expect(runAiJobMock).toHaveBeenCalledTimes(1);
    const saved = state.upserts[0].recommendations as Row[];
    expect(saved).toHaveLength(1);
    expect(saved[0].action_type).toBe("NO_ACTION");
    expect(saved[0].suggested_daily_budget).toBeNull();
    expect(String(saved[0].rationale)).toMatch(/usulan, belum divalidasi/);
    expect(String(saved[0].rationale)).toContain("Performa terlihat baik.");
    // Nothing was routed to the Approval Center.
    expect(state.inserts.filter((i) => i.table === "prompter_approvals")).toEqual([]);
  });

  it("with two channels, only the one below the threshold is downgraded; DECREASE/PAUSE are untouched", async () => {
    state.channels = [
      { id: "cc1", channel: "FACEBOOK", status: "ACTIVE", budget_percentage: 50 },
      { id: "cc2", channel: "INSTAGRAM", status: "ACTIVE", budget_percentage: 50 },
    ];
    state.metrics = [...enoughRows("cc1"), ...[1, 2, 3].map((d) => metric("cc2", d, { clicks: 5 }))];
    aiReturns([
      increase("FACEBOOK"),
      increase("INSTAGRAM"),
      { channel: "TIKTOK", action_type: "PAUSE_CHANNEL", rationale: "Boros.", suggested_daily_budget: null, risk_level: "LOW" },
    ]);

    expect((await generateOptimizationRecommendationsAction("mc1")).error).toBeNull();

    const saved = state.upserts[0].recommendations as Row[];
    const by = (channel: string) => saved.find((r) => r.channel === channel)!;
    expect(by("FACEBOOK").action_type).toBe("INCREASE_BUDGET");
    expect(by("INSTAGRAM").action_type).toBe("NO_ACTION");
    expect(by("INSTAGRAM").suggested_daily_budget).toBeNull();
    // A channel the model invented that has no data row is not allowed a click-based action; PAUSE is not click-based.
    expect(by("TIKTOK").action_type).toBe("PAUSE_CHANNEL");
  });

  it("the prompt tells the model which channels lack data", async () => {
    state.channels = [
      { id: "cc1", channel: "FACEBOOK", status: "ACTIVE", budget_percentage: 50 },
      { id: "cc2", channel: "INSTAGRAM", status: "ACTIVE", budget_percentage: 50 },
    ];
    state.metrics = [...enoughRows("cc1"), metric("cc2", 1, { impressions: 100, clicks: 2 })];
    aiReturns([{ ...increase("FACEBOOK"), action_type: "NO_ACTION", suggested_daily_budget: null }]);

    await generateOptimizationRecommendationsAction("mc1");

    const prompt: string = runAiJobMock.mock.calls[0][0].prompt;
    expect(prompt).toMatch(/INSTAGRAM[^\n]*DATA BELUM CUKUP/);
    expect(prompt).toMatch(/JANGAN direkomendasikan INCREASE_BUDGET/);
  });
});
