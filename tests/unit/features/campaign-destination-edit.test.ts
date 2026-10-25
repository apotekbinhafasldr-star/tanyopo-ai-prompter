import { describe, expect, it, vi, beforeEach } from "vitest";

const { sessionMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(async () => ({ tenantId: "t1", userId: "u1", role: "owner" as string })),
}));
vi.mock("@/services/session", () => ({ requireSessionContext: sessionMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/budget-guard", () => ({
  getOrCreateBudgetPolicy: vi.fn(async () => ({})),
  getMonthToDateSpend: vi.fn(async () => 0),
  checkBudgetGuard: vi.fn(() => ({ allowed: true, reason: null })),
}));
vi.mock("@/services/channel-campaigns", () => ({
  syncChannelCampaigns: vi.fn(async () => undefined),
  mirrorChannelCampaignStatus: vi.fn(async () => ({ ok: true, updated: 1, consistent: true })),
  transitionMasterCampaign: vi.fn(async () => "moved"),
  isMirrorConfirmed: (r: { ok: boolean; consistent: boolean }) => r.ok && r.consistent,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => current) }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let current: any;

import { updateCampaignDestinationAction, submitForApprovalAction } from "@/features/campaigns/actions";

const WEB = { version: 1, type: "WEBSITE", value: "https://tokosaya.com/a", link: "https://tokosaya.com/a" };

function form(type: string, value: string) {
  const f = new FormData();
  f.set("destinationType", type);
  f.set("destinationValue", value);
  return f;
}

function build(opts: {
  campaign?: { id: string; status: string; ai_proposal: unknown; daily_budget?: number; total_budget?: number; currency?: string } | null;
  pending?: { id: string }[];
  updatedRows?: { id: string }[];
}) {
  const eqCalls: [string, unknown][] = [];
  const update = vi.fn((values: unknown) => {
    void values;
    const b: Record<string, unknown> = {};
    b.eq = (c: string, v: unknown) => {
      eqCalls.push([c, v]);
      return b;
    };
    b.select = async () => ({ data: opts.updatedRows ?? [{ id: "c1" }], error: null });
    return b;
  });
  const approvalInsert = vi.fn(async (row: unknown) => (void row, { error: null }));
  const auditInsert = vi.fn(async (row: unknown) => (void row, { error: null }));
  const selectEqs: [string, unknown][] = [];
  const from = vi.fn((table: string) => {
    if (table === "prompter_master_campaigns") {
      return {
        select: () => {
          const b: Record<string, unknown> = {};
          b.eq = (c: string, v: unknown) => {
            selectEqs.push([c, v]);
            return b;
          };
          b.single = async () => ({ data: opts.campaign === undefined ? null : opts.campaign, error: null });
          return b;
        },
        update,
      };
    }
    if (table === "prompter_approvals") {
      return {
        insert: approvalInsert,
        select: () => {
          const b: Record<string, unknown> = {};
          b.eq = () => b;
          b.limit = async () => ({ data: opts.pending ?? [], error: null });
          return b;
        },
      };
    }
    if (table === "prompter_audit_logs") return { insert: auditInsert };
    throw new Error(`unexpected table ${table}`);
  });
  const rpc = vi.fn(async () => ({ data: [{ allowed: true, reason: null }], error: null }));
  return { from, rpc, update, eqCalls, selectEqs, approvalInsert, auditInsert };
}

const draft = (ai_proposal: unknown) => ({ id: "c1", status: "DRAFT", ai_proposal });
const INIT = { error: null, saved: false };

beforeEach(() => {
  sessionMock.mockResolvedValue({ tenantId: "t1", userId: "u1", role: "owner" });
});

describe("updateCampaignDestinationAction", () => {
  it("owner updates a DRAFT website destination, scoped by tenant and DRAFT, other proposal keys kept", async () => {
    current = build({ campaign: draft({ headline: "H", purchase_destination: WEB }) });
    const r = await updateCampaignDestinationAction("c1", INIT, form("WHATSAPP", "081234567890"));
    expect(r).toEqual({ error: null, saved: true });
    const written = current.update.mock.calls[0][0].ai_proposal;
    expect(written.headline).toBe("H");
    expect(written.purchase_destination).toMatchObject({ type: "WHATSAPP", link: "https://wa.me/6281234567890" });
    expect(current.eqCalls).toContainEqual(["tenant_id", "t1"]);
    expect(current.eqCalls).toContainEqual(["status", "DRAFT"]);
    expect(current.selectEqs).toContainEqual(["tenant_id", "t1"]);
  });

  it("marketing may edit", async () => {
    sessionMock.mockResolvedValue({ tenantId: "t1", userId: "u1", role: "marketing" });
    current = build({ campaign: draft({ headline: "H" }) });
    const r = await updateCampaignDestinationAction("c1", INIT, form("WEBSITE", "https://tokosaya.com/b"));
    expect(r.saved).toBe(true);
  });

  it.each(["kasir", "apoteker", "admin_gudang", "hr"])("role %s is refused with no read or write", async (role) => {
    sessionMock.mockResolvedValue({ tenantId: "t1", userId: "u1", role });
    current = build({ campaign: draft({ headline: "H" }) });
    const r = await updateCampaignDestinationAction("c1", INIT, form("WEBSITE", "https://tokosaya.com/b"));
    expect(r.saved).toBe(false);
    expect(r.error).toMatch(/Owner atau Marketing/);
    expect(current.from).not.toHaveBeenCalled();
    expect(current.update).not.toHaveBeenCalled();
  });

  it.each(["PENDING_APPROVAL", "SCHEDULED", "ACTIVE", "COMPLETED"])("status %s is not editable", async (status) => {
    current = build({ campaign: { id: "c1", status, ai_proposal: { headline: "H" } } });
    const r = await updateCampaignDestinationAction("c1", INIT, form("WEBSITE", "https://tokosaya.com/b"));
    expect(r.saved).toBe(false);
    expect(r.error).toMatch(/Draft/);
    expect(current.update).not.toHaveBeenCalled();
  });

  it("another tenant's campaign (not found under tenant filter) is not edited", async () => {
    current = build({ campaign: null });
    const r = await updateCampaignDestinationAction("c1", INIT, form("WEBSITE", "https://tokosaya.com/b"));
    expect(r.error).toMatch(/tidak ditemukan/);
    expect(current.update).not.toHaveBeenCalled();
    expect(current.selectEqs).toContainEqual(["tenant_id", "t1"]);
  });

  it("refuses while an approval is pending", async () => {
    current = build({ campaign: draft({ headline: "H" }), pending: [{ id: "a1" }] });
    const r = await updateCampaignDestinationAction("c1", INIT, form("WEBSITE", "https://tokosaya.com/b"));
    expect(r.error).toMatch(/sedang diajukan/);
    expect(current.update).not.toHaveBeenCalled();
  });

  it.each([
    ["WEBSITE", "http://tokosaya.com"],
    ["WEBSITE", "https://tanyopo-ai-prompter.netlify.app/x"],
    ["WEBSITE", "https://tanyopo.ai/"],
    ["WEBSITE", "https://127.0.0.1/"],
    ["WEBSITE", "https://user:pw@tokosaya.com/"],
    ["WHATSAPP", "123"],
    ["BOGUS", "x"],
    ["", ""],
  ])("invalid %s %s is rejected on the server before any read", async (t, v) => {
    current = build({ campaign: draft({ headline: "H" }) });
    const r = await updateCampaignDestinationAction("c1", INIT, form(t, v));
    expect(r.saved).toBe(false);
    expect(r.error).toBeTruthy();
    expect(current.update).not.toHaveBeenCalled();
  });

  it("audit log records the kind of change, never the URL or number", async () => {
    current = build({ campaign: draft({ headline: "H", purchase_destination: WEB }) });
    await updateCampaignDestinationAction("c1", INIT, form("WHATSAPP", "081234567890"));
    const audit = JSON.stringify(current.auditInsert.mock.calls[0][0]);
    expect(audit).toContain("campaign.destination_updated");
    expect(audit).not.toContain("tokosaya");
    expect(audit).not.toContain("0812345");
  });

  it("an update that matched no row (status changed meanwhile) is reported, not success", async () => {
    current = build({ campaign: draft({ headline: "H" }), updatedRows: [] });
    const r = await updateCampaignDestinationAction("c1", INIT, form("WEBSITE", "https://tokosaya.com/b"));
    expect(r.saved).toBe(false);
    expect(current.auditInsert).not.toHaveBeenCalled();
  });

  it("only ai_proposal is written (no product / brand / status columns)", async () => {
    current = build({ campaign: draft({ headline: "H" }) });
    await updateCampaignDestinationAction("c1", INIT, form("WEBSITE", "https://tokosaya.com/b"));
    expect(Object.keys(current.update.mock.calls[0][0])).toEqual(["ai_proposal"]);
    expect(current.from.mock.calls.map((c: unknown[]) => c[0])).not.toContain("prompter_products");
  });
});

describe("submitForApprovalAction — destination snapshot", () => {
  const base = { daily_budget: 100, total_budget: 1000, currency: "IDR" };

  it("stores the current destination in the approval context", async () => {
    current = build({ campaign: { id: "c1", status: "DRAFT", ai_proposal: { purchase_destination: WEB }, ...base } });
    const r = await submitForApprovalAction("c1");
    expect(r.error).toBeNull();
    const row = current.approvalInsert.mock.calls[0][0];
    expect(row.tenant_id).toBe("t1");
    expect(row.context.daily_budget).toBe(100);
    expect(row.context.destination_snapshot).toMatchObject({ kind: "destination", type: "WEBSITE", link: WEB.link });
  });

  it("legacy campaign records a legacy snapshot", async () => {
    current = build({ campaign: { id: "c1", status: "DRAFT", ai_proposal: { headline: "H" }, ...base } });
    await submitForApprovalAction("c1");
    expect(current.approvalInsert.mock.calls[0][0].context.destination_snapshot).toEqual({ version: 1, kind: "legacy" });
  });
});
