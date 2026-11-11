import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AD_ACCOUNT_A,
  AD_ACCOUNT_B,
  CHANNEL_A1,
  CHANNEL_A2,
  CHANNEL_B1,
  MASTER_A,
  MASTER_B,
  SESSION_A_MARKETING,
  SESSION_A_OWNER,
  SESSION_B_OWNER,
  TENANT_A,
  TENANT_B,
  approvalFor,
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
 * MOCK E2E — One-Click Ads (in-memory). BUKAN bukti E2E nyata.
 *
 * Seluruh alur dijalankan lewat server action ASLI (submit -> approval Owner ->
 * launch -> sync insight -> rekomendasi optimasi) di atas database palsu
 * in-memory dan CONNECTOR PALSU. Tidak ada koneksi jaringan, tidak ada akun iklan,
 * tidak ada Supabase/Meta sungguhan. Yang dibuktikan HANYA urutan dan guard di
 * kode kita sendiri; perilaku Meta, RLS dan Postgres nyata tidak dibuktikan di sini.
 *
 * Gate S1 DIBUKA hanya di berkas ini, lewat vi.mock modul (META saja, logika
 * evaluasi gate tetap ASLI). Gate S1 sungguhan tetap terkunci; buktinya ada di
 * one-click-ads-mock-e2e-gate-closed.test.ts. Dua kunci lain yang saat ini
 * menolak launch Meta juga disimulasikan terbuka lewat vi.mock di bawah:
 * satuan budget IDR dan kontrak objective BRAND_AWARENESS.
 */

let world: OneClickWorld;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/session", () => ({ requireSessionContext: vi.fn(async () => world.session) }));

const { decryptTokenMock, getConnectorMock, createAdminClientMock, runAiJobMock } = vi.hoisted(() => ({
  decryptTokenMock: vi.fn(() => "access-token-fake"),
  getConnectorMock: vi.fn(() => world.ads.connector),
  createAdminClientMock: vi.fn(() => world.admin),
  runAiJobMock: vi.fn(async (params: { jobType: string }) => ({
    ok: true as const,
    jobId: `job-${params.jobType}`,
    model: "fake-model",
    data: {
      summary: "Facebook menghabiskan budget tanpa konversi tercatat; evaluasi sebelum menambah budget.",
      recommendations: [
        {
          channel: "FACEBOOK",
          action_type: "DECREASE_BUDGET",
          rationale: "Spend berjalan tetapi belum ada kontribusi margin; turunkan budget.",
          suggested_daily_budget: 30000,
          risk_level: "LOW",
        },
      ],
    },
  })),
}));
vi.mock("@/lib/crypto/token-cipher", () => ({ decryptToken: decryptTokenMock }));
vi.mock("@/lib/connectors/get-connector", () => ({ getConnector: getConnectorMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => world.client) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
// Penyedia AI sungguhan dipanggil lewat jaringan: diganti jawaban tetap.
vi.mock("@/services/ai-jobs", () => ({ runAiJob: runAiJobMock }));

// GATE S1 DIBUKA UNTUK META, HANYA DI TES INI. Logika evaluasi gate tetap yang asli (core), daftar
// platform saja yang disuntik. Gate produksi sendiri tidak diubah dan tetap kosong.
vi.mock("@/lib/campaigns/external-budget-guard", async () => {
  const core = await import("@/lib/campaigns/external-budget-guard-core");
  const enabled: readonly import("@/types/database").ConnectorPlatform[] = ["META"];
  return {
    BUDGET_WRITE_DISABLED_MESSAGE: core.BUDGET_WRITE_DISABLED_MESSAGE,
    isBudgetWritePlatformEnabled: (platform: import("@/types/database").ConnectorPlatform) => enabled.includes(platform),
    evaluateExternalBudgetWrite: (request: import("@/lib/campaigns/external-budget-guard-core").ExternalBudgetWriteRequest) =>
      core.evaluateWithPlatforms(request, enabled),
  };
});
// Konfirmasi akun iklan oleh Owner dicakup launch-meta-account-evidence.test.ts; di sini dianggap sudah dikonfirmasi.
vi.mock("@/features/connections/meta-selection-confirmation", () => ({
  AD_ACCOUNT_SELECTED_ACTION: "connection.meta_ad_account_selected",
  readSelectionConfirmed: vi.fn(async () => ({ ok: true as const, confirmed: true })),
}));
// Satuan budget IDR belum terverifikasi di kode produksi. Validator ASLI tetap dipakai (batas budget yang
// disetujui Owner, alokasi, kecocokan mata uang); hanya tabel satuannya disuntik agar launch bisa dilanjutkan.
vi.mock("@/lib/campaigns/meta-launch-budget", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/campaigns/meta-launch-budget")>();
  return {
    ...real,
    resolveMetaLaunchBudget: (input: Parameters<typeof real.resolveMetaLaunchBudget>[0]) =>
      real.resolveMetaLaunchBudget(input, { IDR: { minorUnitsPerUnit: 1, verified: true } }),
  };
});
// Kontrak objective BRAND_AWARENESS belum terverifikasi di kode produksi; dibuka di sini seperti tes launch lain.
vi.mock("@/lib/campaigns/meta-objective-contracts", async (importOriginal) => {
  const helpers = await import("../helpers/meta-preflight-fixtures");
  return helpers.verifiedContracts(importOriginal as () => Promise<typeof import("@/lib/campaigns/meta-objective-contracts")>);
});

import { submitForApprovalAction } from "@/features/campaigns/actions";
import { decideApprovalAction } from "@/features/approvals/actions";
import { launchChannelCampaignAction } from "@/features/campaigns/launch-actions";
import { syncChannelCampaignInsightsAction } from "@/features/campaigns/sync-insights-actions";
import { generateOptimizationRecommendationsAction } from "@/features/campaigns/optimization-actions";

const actions: FlowActions = { submit: submitForApprovalAction, decide: decideApprovalAction };

const launch = (id: string) => launchChannelCampaignAction(id);
const writesSince = (n: number) => world.db.log.slice(n).filter((s) => s.op !== "select");

/** Draft -> diajukan oleh Marketing -> disetujui Owner. Hasilnya SCHEDULED. */
async function approveCampaignA(): Promise<void> {
  const flow = await submitThenOwnerApprove(world, actions, MASTER_A, { submitter: SESSION_A_MARKETING, owner: SESSION_A_OWNER });
  expect(flow.submitted.error).toBeNull();
  expect(flow.decided.error).toBeNull();
}

/** Ditolak SEBELUM menyentuh platform mana pun: tidak ada kredensial, connector, klaim, maupun tulisan. */
function expectNoPlatformContactAndNoWrites(logLengthBefore: number): void {
  expect(world.ads.calls).toEqual([]);
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

describe("MOCK E2E (in-memory, BUKAN bukti E2E nyata) — urutan alur One-Click", () => {
  it("draft -> ajukan -> Owner setuju -> launch PAUSED -> sync insight -> rekomendasi, dengan guard di tiap langkah", async () => {
    // 0. Draft: belum ada persetujuan, semua DRAFT.
    expect(rowOf(world, "prompter_master_campaigns", MASTER_A)?.status).toBe("DRAFT");
    expect(channelStatus(world, CHANNEL_A1)).toBe("DRAFT");
    expect(world.db.tables.prompter_approvals).toEqual([]);

    // 1. Marketing mengajukan: master dan channel AWAITING_APPROVAL, approval PENDING dengan snapshot tujuan.
    world.session = SESSION_A_MARKETING;
    expect((await submitForApprovalAction(MASTER_A)).error).toBeNull();
    expect(rowOf(world, "prompter_master_campaigns", MASTER_A)?.status).toBe("AWAITING_APPROVAL");
    expect(channelStatus(world, CHANNEL_A1)).toBe("AWAITING_APPROVAL");
    const approval = approvalFor(world, MASTER_A)!;
    expect(approval).toMatchObject({ approval_type: "CAMPAIGN_LAUNCH", status: "PENDING", tenant_id: TENANT_A });
    expect(approval.context).toMatchObject({ daily_budget: 100000, destination_snapshot: { kind: "legacy_url" } });

    // 2. Belum disetujui: launch ditolak tanpa menyentuh platform.
    world.session = SESSION_A_OWNER;
    const mark = world.db.log.length;
    expect((await launch(CHANNEL_A1)).error).toMatch(/harus berstatus Terjadwal/);
    expectNoPlatformContactAndNoWrites(mark);

    // 3. Owner menyetujui: approval APPROVED, master dan channel SCHEDULED.
    expect((await decideApprovalAction(String(approval.id), "APPROVED", null)).error).toBeNull();
    expect(approvalFor(world, MASTER_A)?.status).toBe("APPROVED");
    expect(rowOf(world, "prompter_master_campaigns", MASTER_A)?.status).toBe("SCHEDULED");
    expect(channelStatus(world, CHANNEL_A1)).toBe("SCHEDULED");

    // 4. Launch: semua objek dibuat PAUSED, status channel PAUSED, tidak ada aktivasi.
    expect((await launch(CHANNEL_A1)).error).toBeNull();
    expect(channelStatus(world, CHANNEL_A1)).toBe("PAUSED");
    expect(channelStatus(world, CHANNEL_A2)).toBe("SCHEDULED");
    expect(world.ads.objects.map((o) => o.type)).toEqual(["campaign", "adSet", "creative", "ad"]);
    expect(world.ads.objects.every((o) => o.status === "PAUSED")).toBe(true);

    // 5. Sync insight: campaign PAUSED yang punya id platform BOLEH sync (read-only, setelah PR #115).
    const platformWritesBeforeSync = world.ads.writeCalls().length;
    expect((await syncChannelCampaignInsightsAction(CHANNEL_A1)).error).toBeNull();
    expect(world.ads.countOf("getInsights")).toBe(1);
    expect(world.ads.writeCalls()).toHaveLength(platformWritesBeforeSync);
    expect(channelStatus(world, CHANNEL_A1)).toBe("PAUSED");
    expect(world.db.tables.prompter_marketing_metrics).toHaveLength(1);
    expect(world.db.tables.prompter_marketing_metrics[0]).toMatchObject({
      tenant_id: TENANT_A,
      master_campaign_id: MASTER_A,
      channel_campaign_id: CHANNEL_A1,
      platform: "FACEBOOK",
      spend: world.ads.insights.spend,
    });

    // 6. Rekomendasi optimasi: tersimpan, tidak membuat approval baru dan tidak menulis budget ke platform.
    const approvalsBefore = world.db.tables.prompter_approvals.length;
    const writesBefore = world.ads.writeCalls().length;
    expect((await generateOptimizationRecommendationsAction(MASTER_A)).error).toBeNull();
    expect(runAiJobMock).toHaveBeenCalledTimes(1);
    expect(world.db.tables.prompter_optimization_recommendations).toHaveLength(1);
    expect(world.db.tables.prompter_optimization_recommendations[0]).toMatchObject({
      tenant_id: TENANT_A,
      master_campaign_id: MASTER_A,
    });
    expect(world.db.tables.prompter_approvals).toHaveLength(approvalsBefore);
    expect(world.ads.writeCalls()).toHaveLength(writesBefore);
    expect(world.ads.countOf("updateBudget")).toBe(0);

    // Urutan jejak audit mengikuti urutan alur.
    expect(auditActions(world)).toEqual([
      "campaign.submitted_for_approval",
      "campaign.approved",
      "campaign.launched",
      "metrics.synced",
    ]);
  });
});

describe("MOCK E2E (in-memory, BUKAN bukti E2E nyata) — (1) launch ditolak tanpa approval Owner", () => {
  it("campaign masih DRAFT (belum diajukan)", async () => {
    const mark = world.db.log.length;
    expect((await launch(CHANNEL_A1)).error).toMatch(/harus berstatus Terjadwal/);
    expectNoPlatformContactAndNoWrites(mark);
  });

  it("campaign menunggu persetujuan (PENDING)", async () => {
    world.session = SESSION_A_MARKETING;
    expect((await submitForApprovalAction(MASTER_A)).error).toBeNull();
    world.session = SESSION_A_OWNER;
    const mark = world.db.log.length;
    expect((await launch(CHANNEL_A1)).error).toMatch(/harus berstatus Terjadwal/);
    expectNoPlatformContactAndNoWrites(mark);
  });

  it("Owner menolak (REJECTED): campaign kembali DRAFT dan tidak bisa diluncurkan", async () => {
    world.session = SESSION_A_MARKETING;
    await submitForApprovalAction(MASTER_A);
    world.session = SESSION_A_OWNER;
    expect((await decideApprovalAction(String(approvalFor(world, MASTER_A)!.id), "REJECTED", "belum siap")).error).toBeNull();
    expect(rowOf(world, "prompter_master_campaigns", MASTER_A)?.status).toBe("DRAFT");

    const mark = world.db.log.length;
    expect((await launch(CHANNEL_A1)).error).toMatch(/harus berstatus Terjadwal/);
    expectNoPlatformContactAndNoWrites(mark);
  });

  it("Marketing tidak bisa menyetujui; approval tetap PENDING dan launch tetap ditolak", async () => {
    world.session = SESSION_A_MARKETING;
    await submitForApprovalAction(MASTER_A);
    const approvalId = String(approvalFor(world, MASTER_A)!.id);

    expect((await decideApprovalAction(approvalId, "APPROVED", null)).error).toMatch(/Hanya Owner/);
    expect(approvalFor(world, MASTER_A)?.status).toBe("PENDING");
    expect(rowOf(world, "prompter_master_campaigns", MASTER_A)?.status).toBe("AWAITING_APPROVAL");

    const mark = world.db.log.length;
    expect((await launch(CHANNEL_A1)).error).toMatch(/harus berstatus Terjadwal/);
    expectNoPlatformContactAndNoWrites(mark);
  });

  // Pertahanan berlapis: kalau status SCHEDULED entah bagaimana tercapai tanpa approval APPROVED
  // (data diubah di luar alur), launch tetap menolak sebelum kredensial dan klaim.
  interface ForcedApproval {
    status: string;
    created_at?: string;
    resource_id?: string;
    tenant_id?: string;
  }
  const FORCED_CASES: [string, ForcedApproval[]][] = [
    ["tanpa approval sama sekali", []],
    ["approval PENDING", [{ status: "PENDING" }]],
    ["approval REJECTED", [{ status: "REJECTED" }]],
    ["approval EXPIRED", [{ status: "EXPIRED" }]],
    [
      "approval APPROVED lama lalu approval PENDING yang lebih baru",
      [
        { status: "APPROVED", created_at: "2026-10-01T00:00:00Z" },
        { status: "PENDING", created_at: "2026-10-02T00:00:00Z" },
      ],
    ],
    ["approval APPROVED milik campaign tenant lain", [{ status: "APPROVED", resource_id: MASTER_B, tenant_id: TENANT_B }]],
  ];
  it.each(FORCED_CASES)("status SCHEDULED yang dipaksa, %s", async (_label, approvals) => {
    rowOf(world, "prompter_master_campaigns", MASTER_A)!.status = "SCHEDULED";
    rowOf(world, "prompter_channel_campaigns", CHANNEL_A1)!.status = "SCHEDULED";
    for (const [i, a] of approvals.entries()) {
      world.db.tables.prompter_approvals.push({
        id: `forced-${i}`,
        tenant_id: TENANT_A,
        approval_type: "CAMPAIGN_LAUNCH",
        resource_type: "prompter_master_campaigns",
        resource_id: MASTER_A,
        created_at: "2026-10-01T00:00:00Z",
        context: { daily_budget: 100000 },
        ...a,
      });
    }

    const mark = world.db.log.length;
    expect((await launch(CHANNEL_A1)).error).toMatch(/belum memiliki persetujuan peluncuran/);
    expectNoPlatformContactAndNoWrites(mark);
    expect(channelStatus(world, CHANNEL_A1)).toBe("SCHEDULED");
  });
});

describe("MOCK E2E (in-memory, BUKAN bukti E2E nyata) — (3) Emergency Stop", () => {
  it("Emergency Stop aktif: launch ditolak sebelum kredensial, klaim, dan connector", async () => {
    await approveCampaignA();
    world.db.tables.prompter_automation_settings.push({ tenant_id: TENANT_A, emergency_stop_active: true });

    const mark = world.db.log.length;
    expect((await launch(CHANNEL_A1)).error).toMatch(/Emergency Stop aktif/);
    expectNoPlatformContactAndNoWrites(mark);
    expect(channelStatus(world, CHANNEL_A1)).toBe("SCHEDULED");
  });

  it("status Emergency Stop tidak terbaca: gagal tertutup", async () => {
    world = buildOneClickWorld({
      db: { failWhen: ({ table }) => (table === "prompter_automation_settings" ? "settings tidak terbaca" : null) },
    });
    await approveCampaignA();

    const mark = world.db.log.length;
    expect((await launch(CHANNEL_A1)).error).toMatch(/tidak dapat diverifikasi/);
    expectNoPlatformContactAndNoWrites(mark);
    expect(channelStatus(world, CHANNEL_A1)).toBe("SCHEDULED");
  });

  it("Emergency Stop menyala di tengah peluncuran: objek berikutnya tidak dibuat, baris tetap FAILED (tertutup)", async () => {
    await approveCampaignA();
    world.ads.hooks.afterCreate = (type) => {
      if (type === "campaign") {
        world.db.tables.prompter_automation_settings.push({ tenant_id: TENANT_A, emergency_stop_active: true });
      }
    };

    expect((await launch(CHANNEL_A1)).error).toMatch(/Emergency Stop aktif/);
    expect(world.ads.countOf("createCampaign")).toBe(1);
    expect(world.ads.countOf("createAdSet")).toBe(0);
    expect(world.ads.countOf("createCreative")).toBe(0);
    expect(world.ads.countOf("createAd")).toBe(0);
    expect(channelStatus(world, CHANNEL_A1)).toBe("FAILED");
    expect(rowOf(world, "prompter_channel_campaigns", CHANNEL_A1)?.external_campaign_id).toBe("ext_campaign_1");
    expect(world.ads.objects.every((o) => o.status === "PAUSED")).toBe(true);
  });
});

describe("MOCK E2E (in-memory, BUKAN bukti E2E nyata) — (4) role bukan owner/marketing", () => {
  it.each(["apoteker", "kasir", "admin_gudang", "hr"])("%s tidak boleh meluncurkan walau gate dibuka dan campaign sudah disetujui", async (role) => {
    await approveCampaignA();
    world.session = sessionOf(TENANT_A, "user-other", role);

    const mark = world.db.log.length;
    expect((await launch(CHANNEL_A1)).error).toMatch(/tidak memiliki izin untuk meluncurkan/);
    expect(world.db.log.length).toBe(mark); // bahkan tidak ada pembacaan database
    expectNoPlatformContactAndNoWrites(mark);
    expect(channelStatus(world, CHANNEL_A1)).toBe("SCHEDULED");
  });

  it.each(["apoteker", "kasir", "admin_gudang", "hr"])("%s juga tidak boleh sync insight maupun membuat rekomendasi", async (role) => {
    world.session = sessionOf(TENANT_A, "user-other", role);
    const mark = world.db.log.length;

    expect((await syncChannelCampaignInsightsAction(CHANNEL_A1)).error).toMatch(/tidak memiliki izin/);
    expect((await generateOptimizationRecommendationsAction(MASTER_A)).error).toMatch(/tidak memiliki izin/);
    expect(world.db.log.length).toBe(mark);
    expect(world.ads.calls).toEqual([]);
    expect(runAiJobMock).not.toHaveBeenCalled();
  });

  it("hanya Owner yang boleh memutuskan approval", async () => {
    world.session = SESSION_A_MARKETING;
    await submitForApprovalAction(MASTER_A);
    const approvalId = String(approvalFor(world, MASTER_A)!.id);
    for (const role of ["marketing", "apoteker", "kasir", "admin_gudang", "hr"]) {
      world.session = sessionOf(TENANT_A, "user-other", role);
      expect((await decideApprovalAction(approvalId, "APPROVED", null)).error).toMatch(/Hanya Owner/);
    }
    expect(approvalFor(world, MASTER_A)?.status).toBe("PENDING");
  });
});

describe("MOCK E2E (in-memory, BUKAN bukti E2E nyata) — (5) jalur sukses: gate dibuka lewat vi.mock, objek PAUSED", () => {
  it("membuat campaign, ad set, creative, dan ad PAUSED; tidak ada aktivasi atau tulis budget lain", async () => {
    await approveCampaignA();

    expect((await launch(CHANNEL_A1)).error).toBeNull();

    // Urutan panggilan ke connector palsu: baca mata uang (read-only), lalu empat pembuatan objek, tidak ada yang lain.
    expect(world.ads.calls.map((c) => c.method)).toEqual([
      "getAdAccountCurrencyEvidence",
      "createCampaign",
      "createAdSet",
      "createCreative",
      "createAd",
    ]);
    expect(world.ads.countOf("updateBudget")).toBe(0);
    expect(world.ads.countOf("pauseCampaign")).toBe(0);
    expect(world.ads.objects.map((o) => o.type)).toEqual(["campaign", "adSet", "creative", "ad"]);
    expect(world.ads.objects.every((o) => o.status === "PAUSED")).toBe(true);
    expect(world.ads.objects.every((o) => o.adAccountId === AD_ACCOUNT_A)).toBe(true);
    // Kode produksi tidak pernah meminta status aktif pada pembuatan objek.
    for (const object of world.ads.objects) expect(Object.keys(object.input)).not.toContain("status");

    const campaignInput = world.ads.objects[0].input;
    const adSetInput = world.ads.objects[1].input;
    const creativeInput = world.ads.objects[2].input;
    expect(campaignInput.dailyBudgetMinorUnits).toBe(60000); // jatah 60% dari 100000
    expect(adSetInput).toMatchObject({ campaignId: "ext_campaign_1", dailyBudgetMinorUnits: 60000, targetingCountries: ["ID"] });
    expect(creativeInput).toMatchObject({ pageId: `page_${TENANT_A}` });
    expect(String(creativeInput.linkUrl)).toContain("toko-saya.co.id");
    expect(String(creativeInput.imageUrl)).toContain(`${TENANT_A}/p-a/`);

    // Status akhir di database: PAUSED, id eksternal tercatat, tidak pernah ACTIVE.
    const row = rowOf(world, "prompter_channel_campaigns", CHANNEL_A1)!;
    expect(row).toMatchObject({ status: "PAUSED", external_campaign_id: "ext_campaign_1", error: null });
    expect(world.db.log.some((s) => s.table === "prompter_channel_campaigns" && s.payload?.status === "ACTIVE")).toBe(false);
    expect(channelStatus(world, CHANNEL_A2)).toBe("SCHEDULED"); // channel lain tidak tersentuh
    expect(auditActions(world)).toContain("campaign.launched");
  });
});

describe("MOCK E2E (in-memory, BUKAN bukti E2E nyata) — (6) idempotensi: tidak ada objek ganda", () => {
  const expectExactlyOneObjectSet = () => {
    expect(world.ads.countOf("createCampaign")).toBe(1);
    expect(world.ads.countOf("createAdSet")).toBe(1);
    expect(world.ads.countOf("createCreative")).toBe(1);
    expect(world.ads.countOf("createAd")).toBe(1);
    expect(world.ads.objects).toHaveLength(4);
  };

  it("launch kedua setelah sukses ditolak dan tidak membuat objek baru", async () => {
    await approveCampaignA();
    expect((await launch(CHANNEL_A1)).error).toBeNull();

    const second = await launch(CHANNEL_A1);
    expect(second.error).toMatch(/sudah diluncurkan atau sedang diproses/);
    expectExactlyOneObjectSet();
    expect(channelStatus(world, CHANNEL_A1)).toBe("PAUSED");
    expect(rowOf(world, "prompter_channel_campaigns", CHANNEL_A1)?.external_campaign_id).toBe("ext_campaign_1");
  });

  it("dua launch bersamaan: tepat satu menang klaim atomik, satu ditolak, satu set objek", async () => {
    await approveCampaignA();

    const results = await Promise.all([launch(CHANNEL_A1), launch(CHANNEL_A1)]);

    expect(results.filter((r) => r.error === null)).toHaveLength(1);
    const loser = results.find((r) => r.error !== null);
    expect(loser?.error).toMatch(/sudah diluncurkan atau sedang diproses/);
    expectExactlyOneObjectSet();
    expect(channelStatus(world, CHANNEL_A1)).toBe("PAUSED");
    // Hanya satu klaim yang benar-benar mengubah baris (SCHEDULED -> FAILED).
    const claims = world.db.log.filter(
      (s) => s.table === "prompter_channel_campaigns" && s.op === "update" && s.payload?.status === "FAILED" && s.matched === 1,
    );
    expect(claims).toHaveLength(1);
  });

  it("launch ulang setelah gagal di tengah jalan tetap diblokir dan tidak membuat objek ganda", async () => {
    await approveCampaignA();
    world.ads.connector.createAdSet.mockRejectedValueOnce(new Error("jaringan putus"));

    expect((await launch(CHANNEL_A1)).error).toBeTruthy();
    expect(channelStatus(world, CHANNEL_A1)).toBe("FAILED");
    const created = world.ads.objects.length;

    expect((await launch(CHANNEL_A1)).error).toMatch(/sudah diluncurkan atau sedang diproses/);
    expect(world.ads.objects).toHaveLength(created);
    expect(world.ads.countOf("createCampaign")).toBe(1);
    expect(channelStatus(world, CHANNEL_A1)).toBe("FAILED");
  });
});

describe("MOCK E2E (in-memory, BUKAN bukti E2E nyata) — (7) isolasi tenant", () => {
  it("tenant B tidak bisa meluncurkan campaign tenant A (yang sudah disetujui)", async () => {
    await approveCampaignA();
    world.session = SESSION_B_OWNER;

    const mark = world.db.log.length;
    expect((await launch(CHANNEL_A1)).error).toMatch(/Channel campaign tidak ditemukan/);
    expectNoPlatformContactAndNoWrites(mark);
    expect(channelStatus(world, CHANNEL_A1)).toBe("SCHEDULED");
  });

  it("tenant B meluncurkan campaign miliknya memakai akun iklannya sendiri dan tidak mengubah tenant A", async () => {
    await approveCampaignA();
    const flowB = await submitThenOwnerApprove(world, actions, MASTER_B, { submitter: SESSION_B_OWNER, owner: SESSION_B_OWNER });
    expect(flowB.submitted.error).toBeNull();
    expect(flowB.decided.error).toBeNull();

    expect((await launch(CHANNEL_B1)).error).toBeNull();

    expect(world.ads.objects).toHaveLength(4);
    expect(world.ads.calls.every((c) => c.adAccountId === AD_ACCOUNT_B)).toBe(true);
    expect(channelStatus(world, CHANNEL_B1)).toBe("PAUSED");
    expect(channelStatus(world, CHANNEL_A1)).toBe("SCHEDULED");
    expect(channelStatus(world, CHANNEL_A2)).toBe("SCHEDULED");
    expect(world.db.tables.prompter_audit_logs.filter((a) => a.action === "campaign.launched")).toMatchObject([{ tenant_id: TENANT_B }]);
  });

  it("tenant B tidak bisa mengajukan atau menyetujui milik tenant A", async () => {
    world.session = SESSION_A_MARKETING;
    await submitForApprovalAction(MASTER_A);
    const approvalId = String(approvalFor(world, MASTER_A)!.id);

    world.session = SESSION_B_OWNER;
    expect((await decideApprovalAction(approvalId, "APPROVED", null)).error).toMatch(/Approval tidak ditemukan/);
    expect((await submitForApprovalAction(MASTER_A)).error).toMatch(/Campaign tidak ditemukan/);
    expect(approvalFor(world, MASTER_A)?.status).toBe("PENDING");
    expect(rowOf(world, "prompter_master_campaigns", MASTER_A)?.status).toBe("AWAITING_APPROVAL");
  });

  it("tenant B tidak bisa menyinkronkan insight campaign tenant A yang sudah diluncurkan (PAUSED)", async () => {
    await approveCampaignA();
    expect((await launch(CHANNEL_A1)).error).toBeNull();

    world.session = SESSION_B_OWNER;
    const mark = world.db.log.length;
    expect((await syncChannelCampaignInsightsAction(CHANNEL_A1)).error).toMatch(/Channel campaign tidak ditemukan/);
    expect(world.ads.countOf("getInsights")).toBe(0);
    expect(writesSince(mark)).toEqual([]);
    expect(world.db.tables.prompter_marketing_metrics).toEqual([]);
  });

  it("tenant B tidak bisa membuat rekomendasi optimasi untuk campaign tenant A", async () => {
    await approveCampaignA();
    expect((await launch(CHANNEL_A1)).error).toBeNull();
    expect((await syncChannelCampaignInsightsAction(CHANNEL_A1)).error).toBeNull();

    world.session = SESSION_B_OWNER;
    const mark = world.db.log.length;
    expect((await generateOptimizationRecommendationsAction(MASTER_A)).error).toMatch(/Campaign tidak ditemukan/);
    expect(runAiJobMock).not.toHaveBeenCalled();
    expect(writesSince(mark)).toEqual([]);
    expect(world.db.tables.prompter_optimization_recommendations).toEqual([]);
  });
});

describe("MOCK E2E (in-memory, BUKAN bukti E2E nyata) — sync insight dan rekomendasi optimasi", () => {
  // Campaign hasil launch Meta berstatus PAUSED; sync dan rekomendasi berjalan tanpa aktivasi apa pun.
  async function launchedPaused(): Promise<void> {
    await approveCampaignA();
    expect((await launch(CHANNEL_A1)).error).toBeNull();
    expect(channelStatus(world, CHANNEL_A1)).toBe("PAUSED");
  }

  it.each(["SCHEDULED", "DRAFT"])("status %s dengan external_campaign_id terisi tetap ditolak sync", async (status) => {
    const row = rowOf(world, "prompter_channel_campaigns", CHANNEL_A1)!;
    row.status = status;
    row.external_campaign_id = "ext_campaign_stray";

    const mark = world.db.log.length;
    expect((await syncChannelCampaignInsightsAction(CHANNEL_A1)).error).toMatch(/Aktif atau Dijeda/);
    expect(world.ads.countOf("getInsights")).toBe(0);
    expect(world.ads.calls).toEqual([]);
    expect(writesSince(mark)).toEqual([]);
    expect(world.db.tables.prompter_marketing_metrics).toEqual([]);
  });

  it("sync berulang pada hari yang sama memperbarui satu baris metrik (upsert), tidak menggandakan", async () => {
    await launchedPaused();

    expect((await syncChannelCampaignInsightsAction(CHANNEL_A1)).error).toBeNull();
    world.ads.insights.spend = 20000;
    expect((await syncChannelCampaignInsightsAction(CHANNEL_A1)).error).toBeNull();

    expect(world.db.tables.prompter_marketing_metrics).toHaveLength(1);
    expect(world.db.tables.prompter_marketing_metrics[0].spend).toBe(20000);
    expect(world.ads.countOf("getInsights")).toBe(2);
  });

  it("rekomendasi ditolak selama belum ada data spend atau konversi (tidak memanggil AI)", async () => {
    await launchedPaused();

    expect((await generateOptimizationRecommendationsAction(MASTER_A)).error).toMatch(/Belum ada data spend/);
    expect(runAiJobMock).not.toHaveBeenCalled();
    expect(world.db.tables.prompter_optimization_recommendations).toEqual([]);
  });

  it("rekomendasi memakai data hasil sync, hanya menyimpan saran, dan tidak menulis budget ke platform", async () => {
    await launchedPaused();
    expect((await syncChannelCampaignInsightsAction(CHANNEL_A1)).error).toBeNull();
    const writesBefore = world.ads.writeCalls().length;

    expect((await generateOptimizationRecommendationsAction(MASTER_A)).error).toBeNull();

    expect(runAiJobMock).toHaveBeenCalledTimes(1);
    expect(runAiJobMock.mock.calls[0][0].jobType).toBe("OPTIMIZATION_RECOMMENDATION");
    const saved = world.db.tables.prompter_optimization_recommendations;
    expect(saved).toHaveLength(1);
    expect(saved[0].recommendations).toMatchObject([{ channel: "FACEBOOK", action_type: "DECREASE_BUDGET" }]);
    // Mode otomatis tidak aktif: tidak ada approval AUTOPILOT_ACTION dan tidak ada tulis budget.
    expect(world.db.tables.prompter_approvals.filter((a) => a.approval_type === "AUTOPILOT_ACTION")).toEqual([]);
    expect(world.ads.writeCalls()).toHaveLength(writesBefore);
    expect(world.ads.countOf("updateBudget")).toBe(0);
  });
});
