import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHANNEL_A1,
  CHANNEL_A2,
  MASTER_A,
  SESSION_A_MARKETING,
  SESSION_A_OWNER,
  TENANT_A,
  auditActions,
  buildOneClickWorld,
  channelStatus,
  rowOf,
  sessionOf,
  stubLaunchEnv,
  submitThenOwnerApprove,
  type FlowActions,
  type OneClickWorld,
} from "../helpers/one-click-ads-mock-world";

/**
 * MOCK E2E — One-Click Ads, GATE S1 TERKUNCI (in-memory). BUKAN bukti E2E nyata.
 *
 * Berkas ini TIDAK memock gate S1 (lib/campaigns/external-budget-guard.ts), validator
 * budget, maupun kontrak objective: semuanya kode produksi asli. Hanya tepi I/O yang
 * diganti (sesi, Supabase, kredensial, connector palsu). Tujuannya membuktikan bahwa,
 * selama BUDGET_WRITE_ENABLED_PLATFORMS kosong, alur sampai approval Owner berjalan
 * tetapi launch tidak pernah menyentuh platform iklan sama sekali.
 */

let world: OneClickWorld;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/session", () => ({ requireSessionContext: vi.fn(async () => world.session) }));

const { decryptTokenMock, getConnectorMock, createAdminClientMock } = vi.hoisted(() => ({
  decryptTokenMock: vi.fn(() => "access-token-fake"),
  getConnectorMock: vi.fn(() => world.ads.connector),
  createAdminClientMock: vi.fn(() => world.admin),
}));
vi.mock("@/lib/crypto/token-cipher", () => ({ decryptToken: decryptTokenMock }));
vi.mock("@/lib/connectors/get-connector", () => ({ getConnector: getConnectorMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => world.client) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/services/ai-jobs", () => ({
  runAiJob: vi.fn(async () => {
    throw new Error("AI tidak boleh dipanggil dari tes mock E2E");
  }),
}));

import { submitForApprovalAction } from "@/features/campaigns/actions";
import { decideApprovalAction } from "@/features/approvals/actions";
import { launchChannelCampaignAction } from "@/features/campaigns/launch-actions";
import {
  BUDGET_WRITE_DISABLED_MESSAGE,
  BUDGET_WRITE_ENABLED_PLATFORMS,
  isBudgetWritePlatformEnabled,
} from "@/lib/campaigns/external-budget-guard";

const actions: FlowActions = { submit: submitForApprovalAction, decide: decideApprovalAction };
const writesSince = (n: number) => world.db.log.slice(n).filter((s) => s.op !== "select");

async function approveCampaignA(): Promise<void> {
  const flow = await submitThenOwnerApprove(world, actions, MASTER_A, { submitter: SESSION_A_MARKETING, owner: SESSION_A_OWNER });
  expect(flow.submitted.error).toBeNull();
  expect(flow.decided.error).toBeNull();
}

/** Bukti tidak ada panggilan connector: tidak ada kredensial, tidak ada connector, tidak ada tulisan apa pun. */
function expectLaunchNeverReachedThePlatform(logLengthBefore: number): void {
  expect(world.ads.calls).toEqual([]);
  expect(world.ads.objects).toEqual([]);
  expect(getConnectorMock).not.toHaveBeenCalled();
  expect(decryptTokenMock).not.toHaveBeenCalled();
  expect(createAdminClientMock).not.toHaveBeenCalled();
  expect(writesSince(logLengthBefore)).toEqual([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  stubLaunchEnv();
  world = buildOneClickWorld();
});

describe("MOCK E2E (in-memory, BUKAN bukti E2E nyata) — (2) launch ditolak selama gate S1 kosong", () => {
  it("daftar platform gate S1 produksi kosong, beku, dan menolak setiap platform", () => {
    expect(BUDGET_WRITE_ENABLED_PLATFORMS).toEqual([]);
    expect(Object.isFrozen(BUDGET_WRITE_ENABLED_PLATFORMS)).toBe(true);
    for (const platform of ["META", "TIKTOK", "X"] as const) expect(isBudgetWritePlatformEnabled(platform)).toBe(false);
  });

  it("draft -> ajukan -> Owner setuju berjalan, tetapi launch ditolak gate dan tidak ada panggilan connector", async () => {
    await approveCampaignA();
    expect(rowOf(world, "prompter_master_campaigns", MASTER_A)?.status).toBe("SCHEDULED");
    expect(channelStatus(world, CHANNEL_A1)).toBe("SCHEDULED");

    const mark = world.db.log.length;
    const result = await launchChannelCampaignAction(CHANNEL_A1);

    expect(result.error).toBe(BUDGET_WRITE_DISABLED_MESSAGE);
    expectLaunchNeverReachedThePlatform(mark);
    expect(channelStatus(world, CHANNEL_A1)).toBe("SCHEDULED");
    expect(rowOf(world, "prompter_channel_campaigns", CHANNEL_A1)).toMatchObject({ external_campaign_id: null, error: null });
    expect(auditActions(world)).toEqual(["campaign.submitted_for_approval", "campaign.approved"]);
  });

  it.each([
    ["FACEBOOK", CHANNEL_A1],
    ["INSTAGRAM", CHANNEL_A2],
  ])("channel %s (Meta) ditolak gate", async (_channel, channelId) => {
    await approveCampaignA();
    const mark = world.db.log.length;

    expect((await launchChannelCampaignAction(channelId)).error).toBe(BUDGET_WRITE_DISABLED_MESSAGE);
    expectLaunchNeverReachedThePlatform(mark);
  });

  it.each(["owner", "marketing"])("gate tidak bergantung pada role: %s tetap ditolak", async (role) => {
    await approveCampaignA();
    world.session = sessionOf(TENANT_A, "user-x", role);
    const mark = world.db.log.length;

    expect((await launchChannelCampaignAction(CHANNEL_A1)).error).toBe(BUDGET_WRITE_DISABLED_MESSAGE);
    expectLaunchNeverReachedThePlatform(mark);
  });

  it("tiga launch bersamaan semuanya ditolak tanpa klaim dan tanpa panggilan connector", async () => {
    await approveCampaignA();
    const mark = world.db.log.length;

    const results = await Promise.all([
      launchChannelCampaignAction(CHANNEL_A1),
      launchChannelCampaignAction(CHANNEL_A1),
      launchChannelCampaignAction(CHANNEL_A1),
    ]);

    for (const result of results) expect(result.error).toBe(BUDGET_WRITE_DISABLED_MESSAGE);
    expectLaunchNeverReachedThePlatform(mark);
    expect(channelStatus(world, CHANNEL_A1)).toBe("SCHEDULED");
  });

  it("role di luar owner/marketing ditolak oleh pemeriksaan role, bukan sampai gate, tanpa pembacaan database", async () => {
    await approveCampaignA();
    world.session = sessionOf(TENANT_A, "user-x", "kasir");
    const mark = world.db.log.length;

    expect((await launchChannelCampaignAction(CHANNEL_A1)).error).toMatch(/tidak memiliki izin untuk meluncurkan/);
    expect(world.db.log.length).toBe(mark);
    expectLaunchNeverReachedThePlatform(mark);
  });

  it("rekomendasi optimasi yang disetujui tidak bisa menulis budget: gate menolak sebelum kredensial dan connector", async () => {
    // Baris yang oleh jalur produksi hanya bisa jadi ACTIVE lewat langkah aktivasi yang belum ada; disiapkan langsung sebagai fixture.
    const channel = rowOf(world, "prompter_channel_campaigns", CHANNEL_A1)!;
    channel.status = "ACTIVE";
    channel.external_campaign_id = "ext_campaign_9";
    world.db.tables.prompter_approvals.push({
      id: "ap-auto",
      tenant_id: TENANT_A,
      approval_type: "AUTOPILOT_ACTION",
      resource_type: "prompter_channel_campaigns",
      resource_id: CHANNEL_A1,
      status: "PENDING",
      created_at: "2026-10-01T00:00:00Z",
      context: { action_type: "INCREASE_BUDGET", suggested_daily_budget: 80000 },
    });

    world.session = SESSION_A_OWNER;
    const result = await decideApprovalAction("ap-auto", "APPROVED", null);

    expect(result.error).toBeNull(); // keputusan Owner tersimpan, eksekusinya yang dibatalkan
    expect(rowOf(world, "prompter_approvals", "ap-auto")?.status).toBe("APPROVED");
    expect(String(rowOf(world, "prompter_approvals", "ap-auto")?.reason)).toMatch(/Eksekusi dibatalkan/);
    expect(auditActions(world)).toContain("autopilot_action.blocked_budget_gate");
    expect(world.ads.countOf("updateBudget")).toBe(0);
    expect(world.ads.calls).toEqual([]);
    expect(getConnectorMock).not.toHaveBeenCalled();
    expect(decryptTokenMock).not.toHaveBeenCalled();
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });
});
