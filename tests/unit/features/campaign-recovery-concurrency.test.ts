import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb, type Row } from "../helpers/stateful-fake-db";
import { checkLaunchApproval } from "@/lib/campaigns/meta-launch-preflight";

/**
 * BEHAVIOUR tests on a stateful in-memory database (every statement atomic, like one PostgREST request,
 * `updated_at` bumped by a modelled trigger). Real server actions and real services; only the edges are
 * mocked. A "concurrent writer" is injected right before a chosen statement executes.
 */
const state = vi.hoisted(() => ({ role: "owner" as string, tenantId: "t1" }));
vi.mock("@/services/session", () => ({
  requireSessionContext: vi.fn(async () => ({ tenantId: state.tenantId, userId: "u1", role: state.role })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({ from: vi.fn() })) }));
vi.mock("@/lib/crypto/token-cipher", () => ({ decryptToken: vi.fn() }));
vi.mock("@/lib/connectors/get-connector", () => ({ getConnector: vi.fn() }));
vi.mock("@/services/budget-guard", () => ({
  getOrCreateBudgetPolicy: vi.fn(async () => ({})),
  getMonthToDateSpend: vi.fn(async () => 0),
  checkBudgetGuard: vi.fn(() => ({ allowed: true, reason: null })),
}));
vi.mock("@/services/channel-performance", () => ({ getTenantChannelPerformance: vi.fn(async () => []) }));
const prompts = vi.hoisted(() => ({
  buildSystemPreamble: vi.fn(() => "system"),
  buildCampaignProposalPrompt: vi.fn((..._args: unknown[]) => (void _args, "prompt")),
}));
vi.mock("@/lib/ai/prompts", () => prompts);
const ai = vi.hoisted(() => ({
  hook: null as null | (() => void),
  run: vi.fn(),
}));
vi.mock("@/services/ai-jobs", () => ({ runAiJob: ai.run }));
vi.mock("@/services/channel-campaigns", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/services/channel-campaigns")>();
  return { ...real, syncChannelCampaigns: vi.fn(async () => undefined) };
});

let db: FakeDb;
let hook: ((ctx: { table: string; op: string; db: FakeDb }) => void) | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (t: string) => db.from(t),
    // fn_reserve_active_campaign_slot: DRAFT -> AWAITING_APPROVAL in one step (trigger bumps updated_at).
    rpc: async (_fn: string, args: { p_campaign_id: string }) => {
      void _fn;
      const m = db.tables.prompter_master_campaigns.find((r) => r.id === args.p_campaign_id && r.status === "DRAFT");
      if (!m) return { data: [{ allowed: false, reason: "NOT_DRAFT" }], error: null };
      m.status = "AWAITING_APPROVAL";
      m.updated_at = `ts-rpc-${db.log.length}`;
      return { data: [{ allowed: true, reason: null }], error: null };
    },
  })),
}));

import {
  cancelSubmissionAction,
  recoverBlockedScheduledCampaignAction,
  regenerateCampaignProposalAction,
  selectCampaignCandidateAction,
  submitForApprovalAction,
  updateCampaignCopyAction,
  updateCampaignDestinationAction,
} from "@/features/campaigns/actions";
import { decideApprovalAction } from "@/features/approvals/actions";

const M = "m1";
const WEB = { version: 1, type: "WEBSITE", value: "https://tokosaya.com/a", link: "https://tokosaya.com/a" };
const WA = { version: 1, type: "WHATSAPP", value: "6281234567890", link: "https://wa.me/6281234567890" };
const PRODUCT_URL = "https://toko-saya.co.id/produk";
const CAND = { hook: "h", headline: "Baru", cta: "Beli", primary_text: "teks" };
const AI_DATA = { candidates: [CAND, CAND], budget_allocation: [], hook: "h", headline: "Baru", cta: "Beli", primary_text: "teks" };

function seed(over: { master?: Row; channels?: Row[]; approvals?: Row[]; extra?: Record<string, Row[]> } = {}) {
  const channels = over.channels ?? [
    { id: "c1", tenant_id: "t1", master_campaign_id: M, channel: "FACEBOOK", status: "DRAFT", external_campaign_id: null },
    { id: "c2", tenant_id: "t1", master_campaign_id: M, channel: "INSTAGRAM", status: "DRAFT", external_campaign_id: null },
  ];
  return {
    prompter_master_campaigns: [
      {
        id: M,
        tenant_id: "t1",
        status: "DRAFT",
        product_id: "p1",
        objective: "BRAND_AWARENESS",
        channels: ["FACEBOOK", "INSTAGRAM"],
        daily_budget: 100000,
        total_budget: null,
        currency: "IDR",
        ai_proposal: { headline: "Lama", hook: "x", candidates: [CAND, CAND] },
        updated_at: "ts-0",
        ...over.master,
      },
    ],
    prompter_channel_campaigns: channels,
    prompter_approvals: over.approvals ?? [],
    prompter_products: [{ id: "p1", tenant_id: "t1", name: "Produk", website_url: PRODUCT_URL }],
    prompter_brand_profiles: [],
    prompter_audit_logs: [],
    prompter_marketing_metrics: [],
    prompter_manual_ad_metrics: [],
    ...over.extra,
  } as Record<string, Row[]>;
}

function make(s: Record<string, Row[]>) {
  db = createFakeDb(s, {
    touchOnUpdate: { prompter_master_campaigns: "updated_at" },
    insertDefaults: {
      prompter_approvals: (n) => ({ id: `ap${n}`, status: "PENDING", created_at: `2026-10-25T00:00:${String(n).padStart(2, "0")}Z` }),
    },
    beforeExec: (ctx) => hook?.(ctx),
  });
}
const master = () => db.tables.prompter_master_campaigns[0];
const proposal = () => master().ai_proposal as Record<string, unknown>;
const channelStatuses = () => db.tables.prompter_channel_campaigns.map((r) => r.status);
const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};
const dest = (type: string, value: string) => form({ destinationType: type, destinationValue: value });
const DEST_INIT = { error: null, saved: false };
const CAMP_INIT = { error: null };
const REC_INIT = { error: null, done: false };
const REC = () => recoverBlockedScheduledCampaignAction(M, REC_INIT, new FormData());

/** Runs `fn` once, right before the first statement matching the predicate. */
function injectOnce(match: (ctx: { table: string; op: string }) => boolean, fn: () => void) {
  let done = false;
  hook = (ctx) => {
    if (!done && match(ctx)) {
      done = true;
      fn();
    }
  };
}
const bump = (patch: Row) => {
  Object.assign(master(), patch);
  master().updated_at = `ts-concurrent-${db.log.length}`;
};

beforeEach(() => {
  vi.clearAllMocks();
  state.role = "owner";
  state.tenantId = "t1";
  hook = null;
  ai.hook = null;
  ai.run.mockImplementation(async () => {
    ai.hook?.();
    return { ok: true, jobId: "job1", data: AI_DATA };
  });
});

describe("P2-1 lost update on ai_proposal (compare-and-swap)", () => {
  it("copy edit does NOT overwrite a destination saved by a concurrent request", async () => {
    make(seed());
    injectOnce(
      (c) => c.table === "prompter_master_campaigns" && c.op === "update",
      () => bump({ ai_proposal: { ...proposal(), purchase_destination: WEB } }),
    );
    const r = await updateCampaignCopyAction(M, CAMP_INIT, form({ headline: "Judul baru", primaryText: "p", cta: "c", hook: "h" }));
    expect(r.error).toMatch(/baru saja diubah/);
    expect(proposal().purchase_destination).toEqual(WEB);
    expect(proposal().headline).toBe("Lama");
  });

  it("destination edit does NOT overwrite copy saved by a concurrent request", async () => {
    make(seed());
    injectOnce(
      (c) => c.table === "prompter_master_campaigns" && c.op === "update",
      () => bump({ ai_proposal: { ...proposal(), headline: "Dari tab lain" } }),
    );
    const r = await updateCampaignDestinationAction(M, DEST_INIT, dest("WEBSITE", "https://tokosaya.com/a"));
    expect(r.saved).toBe(false);
    expect(r.error).toMatch(/baru saja diubah/);
    expect(proposal().headline).toBe("Dari tab lain");
    expect(proposal().purchase_destination).toBeUndefined();
    expect(db.tables.prompter_audit_logs).toHaveLength(0);
  });

  it("candidate selection does not overwrite a concurrent destination edit", async () => {
    make(seed());
    injectOnce(
      (c) => c.table === "prompter_master_campaigns" && c.op === "update",
      () => bump({ ai_proposal: { ...proposal(), purchase_destination: WEB } }),
    );
    const r = await selectCampaignCandidateAction(M, 1);
    expect(r.error).toMatch(/baru saja diubah/);
    expect(proposal().purchase_destination).toEqual(WEB);
  });

  it("regenerate (seconds of AI) does not overwrite a destination edited while the AI was running", async () => {
    make(seed({ master: { ai_proposal: { headline: "Lama", purchase_destination: WEB } } }));
    ai.hook = () => bump({ ai_proposal: { headline: "Lama", purchase_destination: WA } });
    const r = await regenerateCampaignProposalAction(M);
    expect(r.error).toMatch(/baru saja diubah/);
    expect(proposal().purchase_destination).toEqual(WA);
    expect(proposal().headline).toBe("Lama");
  });

  it("regenerate writes nothing if the campaign was submitted while the AI was running", async () => {
    make(seed({ master: { ai_proposal: { headline: "Lama", purchase_destination: WEB } } }));
    ai.hook = () => bump({ status: "AWAITING_APPROVAL" });
    const r = await regenerateCampaignProposalAction(M);
    expect(r.error).toBeTruthy();
    expect(proposal().headline).toBe("Lama");
  });

  it("each write is one statement scoped by id, tenant, DRAFT and the updated_at that was read", async () => {
    make(seed());
    await updateCampaignDestinationAction(M, DEST_INIT, dest("WEBSITE", "https://tokosaya.com/a"));
    const write = db.log.find((l) => l.table === "prompter_master_campaigns" && l.op === "update")!;
    expect(write.filters).toEqual([["id", M], ["tenant_id", "t1"], ["status", "DRAFT"], ["updated_at", "ts-0"]]);
    expect(write.matched).toBe(1);
  });

  it("without a concurrent writer both edits succeed one after the other", async () => {
    make(seed());
    expect((await updateCampaignDestinationAction(M, DEST_INIT, dest("WEBSITE", "https://tokosaya.com/a"))).saved).toBe(true);
    expect((await updateCampaignCopyAction(M, CAMP_INIT, form({ headline: "Judul", primaryText: "p", cta: "c", hook: "h" }))).error).toBeNull();
    expect(proposal().purchase_destination).toMatchObject({ type: "WEBSITE" });
    expect(proposal().headline).toBe("Judul");
  });
});

describe("regenerate preserves the destination", () => {
  it("a stored destination survives regeneration and is passed to the AI (host only)", async () => {
    make(seed({ master: { ai_proposal: { headline: "Lama", purchase_destination: WEB } } }));
    const r = await regenerateCampaignProposalAction(M);
    expect(r.error).toBeNull();
    expect(proposal().purchase_destination).toEqual(WEB);
    expect(proposal().headline).toBe("Baru");
    expect(prompts.buildCampaignProposalPrompt.mock.calls[0][2]).toEqual({ type: "WEBSITE", host: "tokosaya.com" });
  });

  it("a legacy campaign stays legacy (no destination key is invented)", async () => {
    make(seed());
    await regenerateCampaignProposalAction(M);
    expect(proposal()).not.toHaveProperty("purchase_destination");
  });

  it("another tenant's campaign is not regenerated", async () => {
    state.tenantId = "t2";
    make(seed());
    const r = await regenerateCampaignProposalAction(M);
    expect(r.error).toMatch(/tidak ditemukan/);
    expect(ai.run).not.toHaveBeenCalled();
  });
});

describe("P2-2 race between submit, edit and approval", () => {
  it("a destination edit that slips in during submission can never be approved", async () => {
    make(seed({ master: { ai_proposal: { headline: "Lama", purchase_destination: WEB } } }));
    // Edit lands after submit has read the campaign (snapshot = WEB) but before the status flips.
    injectOnce(
      (c) => c.table === "prompter_approvals" && c.op === "insert",
      () => bump({ ai_proposal: { headline: "Lama", purchase_destination: WA } }),
    );
    expect((await submitForApprovalAction(M)).error).toBeNull();
    expect(master().status).toBe("AWAITING_APPROVAL");

    const decided = await decideApprovalAction("ap1", "APPROVED", null);
    expect(decided.error).toMatch(/berbeda dari yang disetujui/);
    expect(db.tables.prompter_approvals[0].status).toBe("PENDING"); // not consumed
    expect(master().status).toBe("AWAITING_APPROVAL");

    // Recovery path: cancel, re-submit with the real current destination, approve.
    await cancelSubmissionAction(form({ campaignId: M }));
    expect(master().status).toBe("DRAFT");
    expect(db.tables.prompter_approvals[0].status).toBe("EXPIRED");
    expect((await submitForApprovalAction(M)).error).toBeNull();
    const second = db.tables.prompter_approvals[1];
    expect((second.context as Record<string, unknown>).destination_snapshot).toMatchObject({ type: "WHATSAPP" });
    expect((await decideApprovalAction(String(second.id), "APPROVED", null)).error).toBeNull();
    expect(master().status).toBe("SCHEDULED");
  });

  it("while AWAITING_APPROVAL no action can change the destination", async () => {
    make(seed({ master: { ai_proposal: { headline: "Lama", purchase_destination: WEB } } }));
    await submitForApprovalAction(M);
    const r = await updateCampaignDestinationAction(M, DEST_INIT, dest("WHATSAPP", "081234567890"));
    expect(r.saved).toBe(false);
    expect(proposal().purchase_destination).toEqual(WEB);
  });

  it("an edit racing the submit's status flip loses (conditional on DRAFT)", async () => {
    make(seed({ master: { ai_proposal: { headline: "Lama", purchase_destination: WEB } } }));
    injectOnce(
      (c) => c.table === "prompter_master_campaigns" && c.op === "update",
      () => bump({ status: "AWAITING_APPROVAL" }),
    );
    const r = await updateCampaignDestinationAction(M, DEST_INIT, dest("WHATSAPP", "081234567890"));
    expect(r.saved).toBe(false);
    expect(proposal().purchase_destination).toEqual(WEB);
  });

  it("a legacy campaign cannot be approved after its product URL changed since the submission", async () => {
    make(seed());
    expect((await submitForApprovalAction(M)).error).toBeNull();
    expect((db.tables.prompter_approvals[0].context as Record<string, unknown>).destination_snapshot).toEqual({
      version: 1,
      kind: "legacy_url",
      link: PRODUCT_URL,
    });
    db.tables.prompter_products[0].website_url = "https://toko-lain.co.id/";
    const r = await decideApprovalAction("ap1", "APPROVED", null);
    expect(r.error).toMatch(/berbeda dari yang disetujui/);
    expect(db.tables.prompter_approvals[0].status).toBe("PENDING");
  });

  it("an unchanged campaign is approved normally (legacy and new-format)", async () => {
    make(seed());
    await submitForApprovalAction(M);
    expect((await decideApprovalAction("ap1", "APPROVED", null)).error).toBeNull();
    expect(master().status).toBe("SCHEDULED");
  });

  it("a campaign without a destination (NONE) can still be approved; launch refuses it on its own", async () => {
    make(seed({ master: { ai_proposal: { headline: "Lama", purchase_destination: { version: 1, type: "NONE", value: null, link: null } } } }));
    await submitForApprovalAction(M);
    expect((await decideApprovalAction("ap1", "APPROVED", null)).error).toBeNull();
  });
});

describe("P1-1 recovery of a blocked SCHEDULED campaign", () => {
  const oldApproval = (extra: Row = {}): Row => ({
    id: "old1",
    tenant_id: "t1",
    approval_type: "CAMPAIGN_LAUNCH",
    resource_type: "prompter_master_campaigns",
    resource_id: M,
    status: "APPROVED",
    created_at: "2026-10-01T00:00:00Z",
    context: { daily_budget: 100000 },
    ...extra,
  });
  const scheduled = (over: { master?: Row; channels?: Row[]; approvals?: Row[]; extra?: Record<string, Row[]> } = {}) =>
    seed({
      master: { status: "SCHEDULED", ...over.master },
      channels: over.channels ?? [
        { id: "c1", tenant_id: "t1", master_campaign_id: M, channel: "FACEBOOK", status: "SCHEDULED", external_campaign_id: null },
        { id: "c2", tenant_id: "t1", master_campaign_id: M, channel: "INSTAGRAM", status: "SCHEDULED", external_campaign_id: null },
      ],
      approvals: over.approvals ?? [oldApproval()],
      extra: over.extra,
    });

  it("a SCHEDULED campaign whose old approval has no snapshot is returned to DRAFT, approval expired, audit kept", async () => {
    make(scheduled());
    const r = await REC();
    expect(r).toEqual({ error: null, done: true });
    expect(master().status).toBe("DRAFT");
    expect(channelStatuses()).toEqual(["DRAFT", "DRAFT"]);
    expect(db.tables.prompter_approvals[0].status).toBe("EXPIRED");
    expect(db.tables.prompter_audit_logs[0]).toMatchObject({ action: "campaign.recovered_to_draft" });
    expect(db.log.some((l) => l.op === "delete")).toBe(false); // nothing is deleted
  });

  it("the old approval no longer authorises anything, and a fresh submission becomes the latest", async () => {
    make(scheduled());
    await REC();
    expect(checkLaunchApproval(db.tables.prompter_approvals as { status: string; created_at: string }[]).ok).toBe(false);
    expect((await submitForApprovalAction(M)).error).toBeNull();
    const rows = db.tables.prompter_approvals as { status: string; created_at: string }[];
    expect(rows).toHaveLength(2);
    expect(checkLaunchApproval(rows).ok).toBe(false); // new one is PENDING
    expect((await decideApprovalAction("ap1", "APPROVED", null)).error).toBeNull();
    expect(checkLaunchApproval(db.tables.prompter_approvals as { status: string; created_at: string }[]).ok).toBe(true);
  });

  it("a new-format campaign whose destination changed after approval is recoverable", async () => {
    const snap = { destination_snapshot: { version: 1, kind: "destination", type: "WEBSITE", value: WEB.value, link: WEB.link } };
    make(scheduled({ master: { ai_proposal: { headline: "x", purchase_destination: WA } }, approvals: [oldApproval({ context: snap })] }));
    expect((await REC()).done).toBe(true);
  });

  it("a campaign that is NOT blocked (destination equals the approved snapshot) is refused and unchanged", async () => {
    const snap = { destination_snapshot: { version: 1, kind: "destination", type: "WEBSITE", value: WEB.value, link: WEB.link } };
    make(scheduled({ master: { ai_proposal: { headline: "x", purchase_destination: WEB } }, approvals: [oldApproval({ context: snap })] }));
    const r = await REC();
    expect(r.error).toMatch(/tidak terblokir/);
    expect(master().status).toBe("SCHEDULED");
    expect(channelStatuses()).toEqual(["SCHEDULED", "SCHEDULED"]);
    expect(db.tables.prompter_approvals[0].status).toBe("APPROVED");
  });

  it.each(["DRAFT", "AWAITING_APPROVAL", "ACTIVE", "PAUSED", "COMPLETED", "FAILED"])("status %s cannot be recovered", async (status) => {
    make(scheduled({ master: { status } }));
    const r = await REC();
    expect(r.done).toBe(false);
    expect(master().status).toBe(status);
    expect(db.log.some((l) => l.op === "update")).toBe(false);
  });

  it.each([
    ["a channel already launched (ACTIVE)", { status: "ACTIVE", external_campaign_id: "ext1" }],
    ["a channel claimed by a launch (FAILED)", { status: "FAILED", external_campaign_id: null }],
    ["a channel with an external id", { status: "SCHEDULED", external_campaign_id: "ext9" }],
    ["a paused channel", { status: "PAUSED", external_campaign_id: "ext2" }],
  ])("%s blocks recovery and nothing changes", async (_n, patch) => {
    make(
      scheduled({
        channels: [
          { id: "c1", tenant_id: "t1", master_campaign_id: M, channel: "FACEBOOK", status: "SCHEDULED", external_campaign_id: null },
          { id: "c2", tenant_id: "t1", master_campaign_id: M, channel: "INSTAGRAM", ...patch },
        ],
      }),
    );
    const r = await REC();
    expect(r.error).toMatch(/sudah pernah diluncurkan|sedang diproses/);
    expect(master().status).toBe("SCHEDULED");
    expect(db.tables.prompter_channel_campaigns[0].status).toBe("SCHEDULED");
    expect(db.tables.prompter_approvals[0].status).toBe("APPROVED");
  });

  it("any platform ad metrics row blocks recovery", async () => {
    make(scheduled({ extra: { prompter_marketing_metrics: [{ id: "x", tenant_id: "t1", master_campaign_id: M, spend: 0 }] } }));
    const r = await REC();
    expect(r.error).toMatch(/data performa atau pengeluaran/);
    expect(master().status).toBe("SCHEDULED");
  });

  it("any manually entered spend blocks recovery", async () => {
    make(scheduled({ extra: { prompter_manual_ad_metrics: [{ id: "x", tenant_id: "t1", master_campaign_id: M, spend: 10 }] } }));
    const r = await REC();
    expect(r.error).toMatch(/data performa atau pengeluaran/);
    expect(master().status).toBe("SCHEDULED");
  });

  it.each(["kasir", "apoteker", "admin_gudang", "hr"])("role %s is refused before any read", async (role) => {
    state.role = role;
    make(scheduled());
    const r = await REC();
    expect(r.error).toMatch(/Owner atau Marketing/);
    expect(db.log).toHaveLength(0);
  });

  it("marketing may recover", async () => {
    state.role = "marketing";
    make(scheduled());
    expect((await REC()).done).toBe(true);
    expect(master().status).toBe("DRAFT");
  });

  it("another tenant cannot recover this campaign", async () => {
    state.tenantId = "t2";
    make(scheduled());
    const r = await REC();
    expect(r.error).toMatch(/tidak ditemukan/);
    expect(master().status).toBe("SCHEDULED");
    expect(channelStatuses()).toEqual(["SCHEDULED", "SCHEDULED"]);
    expect(db.tables.prompter_approvals[0].status).toBe("APPROVED");
  });

  it("race with a launch claim: the claimed channel is never touched and the rest are put back", async () => {
    make(scheduled());
    // The launch claim (SCHEDULED -> FAILED on one channel) wins right before recovery moves the channels.
    injectOnce(
      (c) => c.table === "prompter_channel_campaigns" && c.op === "update",
      () => {
        const claimed = db.tables.prompter_channel_campaigns[0];
        claimed.status = "FAILED";
        claimed.error = "claim-note";
      },
    );
    const r = await REC();
    expect(r.done).toBe(false);
    expect(master().status).toBe("SCHEDULED");
    expect(channelStatuses()).toEqual(["FAILED", "SCHEDULED"]);
    expect(db.tables.prompter_approvals[0].status).toBe("APPROVED");
  });

  it("race with another status change of the master: channels are restored, nothing is reported done", async () => {
    make(scheduled());
    injectOnce(
      (c) => c.table === "prompter_master_campaigns" && c.op === "update",
      () => bump({ status: "ACTIVE" }),
    );
    const r = await REC();
    expect(r.done).toBe(false);
    expect(master().status).toBe("ACTIVE");
    expect(channelStatuses()).toEqual(["SCHEDULED", "SCHEDULED"]);
    expect(db.tables.prompter_approvals[0].status).toBe("APPROVED");
  });

  it("a database failure while moving channels leaves master and approval untouched", async () => {
    make(scheduled());
    db = createFakeDb(scheduled(), {
      failWhen: (c) => (c.table === "prompter_channel_campaigns" && c.op === "update" ? "boom" : null),
    });
    const r = await REC();
    expect(r.done).toBe(false);
    expect(master().status).toBe("SCHEDULED");
    expect(db.tables.prompter_approvals[0].status).toBe("APPROVED");
  });

  it("an unreadable approval fails closed", async () => {
    db = createFakeDb(scheduled(), {
      failWhen: (c) => (c.table === "prompter_approvals" && c.op === "select" ? "boom" : null),
    });
    const r = await REC();
    expect(r.done).toBe(false);
    expect(master().status).toBe("SCHEDULED");
  });
});
