import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb, type FakeDbOptions, type Row } from "../helpers/stateful-fake-db";

// REAL services/channel-campaigns + REAL actions; only the edges are mocked.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/session", () => ({
  requireSessionContext: vi.fn(async () => ({ tenantId: "t1", userId: "u1", role: "owner" })),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({ from: vi.fn() })) }));
vi.mock("@/lib/crypto/token-cipher", () => ({ decryptToken: vi.fn() }));
vi.mock("@/lib/connectors/get-connector", () => ({ getConnector: vi.fn() }));

let db: FakeDb;
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ from: (t: string) => db.from(t) })) }));

import { decideApprovalAction } from "@/features/approvals/actions";
import { cancelSubmissionAction } from "@/features/campaigns/actions";

const M = "m1";
function seed(over: { approval?: Row; master?: Row; channels?: Row[] } = {}): Record<string, Row[]> {
  return {
    prompter_approvals: [
      {
        id: "ap1",
        tenant_id: "t1",
        approval_type: "CAMPAIGN_LAUNCH",
        resource_type: "prompter_master_campaigns",
        resource_id: M,
        status: "PENDING",
        ...over.approval,
      },
    ],
    prompter_master_campaigns: [{ id: M, tenant_id: "t1", status: "AWAITING_APPROVAL", ...over.master }],
    prompter_channel_campaigns:
      over.channels ?? [
        { id: "c1", tenant_id: "t1", master_campaign_id: M, channel: "FACEBOOK", status: "AWAITING_APPROVAL" },
        { id: "c2", tenant_id: "t1", master_campaign_id: M, channel: "INSTAGRAM", status: "AWAITING_APPROVAL" },
      ],
    prompter_audit_logs: [],
  };
}
const make = (s: Record<string, Row[]>, o?: FakeDbOptions) => (db = createFakeDb(s, o));
const statuses = (table: string) => db.tables[table].map((r) => r.status);
const writes = () => db.log.filter((s) => s.op !== "select" && s.table !== "prompter_audit_logs");

describe("decideApprovalAction — H1", () => {
  beforeEach(() => vi.clearAllMocks());

  it("APPROVE: approval APPROVED, master SCHEDULED, channels SCHEDULED, audit written", async () => {
    make(seed());
    const r = await decideApprovalAction("ap1", "APPROVED", null);
    expect(r.error).toBeNull();
    expect(statuses("prompter_approvals")).toEqual(["APPROVED"]);
    expect(statuses("prompter_master_campaigns")).toEqual(["SCHEDULED"]);
    expect(statuses("prompter_channel_campaigns")).toEqual(["SCHEDULED", "SCHEDULED"]);
    expect(db.tables.prompter_audit_logs[0].action).toBe("campaign.approved");
  });

  it("REJECT: master and channels back to DRAFT", async () => {
    make(seed());
    const r = await decideApprovalAction("ap1", "REJECTED", "no");
    expect(r.error).toBeNull();
    expect(statuses("prompter_master_campaigns")).toEqual(["DRAFT"]);
    expect(statuses("prompter_channel_campaigns")).toEqual(["DRAFT", "DRAFT"]);
    expect(db.tables.prompter_audit_logs[0].action).toBe("campaign.launch_rejected");
  });

  it("the approval claim is scoped by id, tenant and PENDING and reads back exactly one row", async () => {
    make(seed());
    await decideApprovalAction("ap1", "APPROVED", null);
    const claim = db.log.find((s) => s.table === "prompter_approvals" && s.op === "update")!;
    expect(claim.filters).toEqual([["id", "ap1"], ["tenant_id", "t1"], ["status", "PENDING"]]);
    expect(claim.matched).toBe(1);
  });

  it("an already-decided approval writes nothing", async () => {
    make(seed({ approval: { status: "APPROVED" } }));
    const r = await decideApprovalAction("ap1", "REJECTED", null);
    expect(r.error).toMatch(/sudah diputuskan/i);
    expect(writes()).toHaveLength(0);
  });

  it("APPROVE must not re-arm a claimed/launched channel (FAILED, ACTIVE, PAUSED, COMPLETED stay)", async () => {
    make(
      seed({
        channels: [
          { id: "c1", tenant_id: "t1", master_campaign_id: M, status: "AWAITING_APPROVAL" },
          { id: "c2", tenant_id: "t1", master_campaign_id: M, status: "FAILED" },
          { id: "c3", tenant_id: "t1", master_campaign_id: M, status: "ACTIVE" },
          { id: "c4", tenant_id: "t1", master_campaign_id: M, status: "PAUSED" },
          { id: "c5", tenant_id: "t1", master_campaign_id: M, status: "COMPLETED" },
        ],
      }),
    );
    await decideApprovalAction("ap1", "APPROVED", null);
    expect(statuses("prompter_channel_campaigns")).toEqual(["SCHEDULED", "FAILED", "ACTIVE", "PAUSED", "COMPLETED"]);
  });

  it("REJECT must not touch a claimed/launched channel either", async () => {
    make(
      seed({
        channels: [
          { id: "c1", tenant_id: "t1", master_campaign_id: M, status: "FAILED" },
          { id: "c2", tenant_id: "t1", master_campaign_id: M, status: "ACTIVE" },
        ],
      }),
    );
    await decideApprovalAction("ap1", "REJECTED", null);
    expect(statuses("prompter_channel_campaigns")).toEqual(["FAILED", "ACTIVE"]);
  });

  it("another tenant's approval is not found and nothing is written", async () => {
    make(seed({ approval: { tenant_id: "t2" } }));
    const r = await decideApprovalAction("ap1", "APPROVED", null);
    expect(r.error).toMatch(/tidak ditemukan/i);
    expect(writes()).toHaveLength(0);
  });

  it("a database error on the decision claim writes nothing else", async () => {
    make(seed(), { failWhen: ({ table, op }) => (table === "prompter_approvals" && op === "update" ? "db secret" : null) });
    const r = await decideApprovalAction("ap1", "APPROVED", null);
    expect(r.error).toBe("Gagal menyimpan keputusan.");
    expect(r.error).not.toMatch(/secret/);
    expect(statuses("prompter_master_campaigns")).toEqual(["AWAITING_APPROVAL"]);
    expect(statuses("prompter_channel_campaigns")).toEqual(["AWAITING_APPROVAL", "AWAITING_APPROVAL"]);
  });

  it("lost race on the claim (decided between read and write): zero rows -> no master/channel write", async () => {
    make(seed(), {
      beforeExec: ({ table, op, db: d }) => {
        if (table === "prompter_approvals" && op === "update") d.tables.prompter_approvals[0].status = "REJECTED";
      },
    });
    const r = await decideApprovalAction("ap1", "APPROVED", null);
    expect(r.error).toMatch(/sudah diputuskan/i);
    expect(statuses("prompter_master_campaigns")).toEqual(["AWAITING_APPROVAL"]);
    expect(statuses("prompter_channel_campaigns")).toEqual(["AWAITING_APPROVAL", "AWAITING_APPROVAL"]);
  });

  it("master no longer AWAITING_APPROVAL (cancelled/launched meanwhile): fail closed, channels untouched, no audit", async () => {
    make(
      seed({
        master: { status: "SCHEDULED" },
        channels: [{ id: "c1", tenant_id: "t1", master_campaign_id: M, status: "FAILED" }],
      }),
    );
    const r = await decideApprovalAction("ap1", "REJECTED", null);
    expect(r.error).toMatch(/status campaign sudah berubah/i);
    expect(statuses("prompter_master_campaigns")).toEqual(["SCHEDULED"]);
    expect(statuses("prompter_channel_campaigns")).toEqual(["FAILED"]);
    expect(db.tables.prompter_audit_logs).toHaveLength(0);
  });

  it("a mirror failure is reported, never retried, and does not unlock anything", async () => {
    make(seed(), {
      failWhen: ({ table, op }) => (table === "prompter_channel_campaigns" && op === "update" ? "db secret" : null),
    });
    const r = await decideApprovalAction("ap1", "APPROVED", null);
    expect(r.error).toMatch(/status channel gagal diperbarui/i);
    expect(r.error).not.toMatch(/secret/);
    expect(db.log.filter((s) => s.table === "prompter_channel_campaigns" && s.op === "update")).toHaveLength(1);
    expect(statuses("prompter_channel_campaigns")).toEqual(["AWAITING_APPROVAL", "AWAITING_APPROVAL"]);
  });

  describe("concurrent decisions", () => {
    it("two APPROVE at once: exactly one wins and the effects are applied once", async () => {
      make(seed());
      const results = await Promise.all([decideApprovalAction("ap1", "APPROVED", null), decideApprovalAction("ap1", "APPROVED", null)]);
      expect(results.filter((r) => r.error === null)).toHaveLength(1);
      // The race was real: both decisions read the approval as PENDING before either wrote.
      const firstUpdate = db.log.findIndex((s) => s.table === "prompter_approvals" && s.op === "update");
      expect(db.log.slice(0, firstUpdate).filter((s) => s.table === "prompter_approvals" && s.op === "select")).toHaveLength(2);
      expect(db.log.filter((s) => s.table === "prompter_approvals" && s.op === "update" && s.matched === 1)).toHaveLength(1);
      expect(statuses("prompter_master_campaigns")).toEqual(["SCHEDULED"]);
      expect(db.tables.prompter_audit_logs).toHaveLength(1);
    });

    it.each([
      ["APPROVED", "REJECTED"],
      ["REJECTED", "APPROVED"],
    ] as const)("%s racing %s: one winner, and the final state matches the winner", async (a, b) => {
      make(seed());
      const results = await Promise.all([decideApprovalAction("ap1", a, null), decideApprovalAction("ap1", b, null)]);
      expect(results.filter((r) => r.error === null)).toHaveLength(1);
      const winner = statuses("prompter_approvals")[0];
      expect(winner).toBe(results[0].error === null ? a : b);
      expect(statuses("prompter_master_campaigns")).toEqual([winner === "APPROVED" ? "SCHEDULED" : "DRAFT"]);
      expect(new Set(statuses("prompter_channel_campaigns"))).toEqual(new Set([winner === "APPROVED" ? "SCHEDULED" : "DRAFT"]));
    });

    it("8 decisions at once (mixed): one winner only", async () => {
      make(seed());
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => decideApprovalAction("ap1", i % 2 ? "REJECTED" : "APPROVED", null)),
      );
      expect(results.filter((r) => r.error === null)).toHaveLength(1);
      expect(db.tables.prompter_audit_logs).toHaveLength(1);
    });

    it("a late REJECT after APPROVE + launch claim leaves the FAILED channel alone", async () => {
      make(seed());
      await decideApprovalAction("ap1", "APPROVED", null);
      // launch claims the channel (SCHEDULED -> FAILED)
      db.tables.prompter_channel_campaigns[0].status = "FAILED";
      const late = await decideApprovalAction("ap1", "REJECTED", null);
      expect(late.error).toMatch(/sudah diputuskan/i);
      expect(statuses("prompter_channel_campaigns")).toEqual(["FAILED", "SCHEDULED"]);
      expect(statuses("prompter_master_campaigns")).toEqual(["SCHEDULED"]);
    });
  });
});

describe("cancelSubmissionAction — H1", () => {
  const form = () => {
    const f = new FormData();
    f.set("campaignId", M);
    return f;
  };

  it("AWAITING_APPROVAL -> DRAFT for master and channels; the pending approval expires", async () => {
    make(seed());
    await cancelSubmissionAction(form());
    expect(statuses("prompter_master_campaigns")).toEqual(["DRAFT"]);
    expect(statuses("prompter_channel_campaigns")).toEqual(["DRAFT", "DRAFT"]);
    expect(statuses("prompter_approvals")).toEqual(["EXPIRED"]);
  });

  it("an already approved/scheduled campaign is not touched", async () => {
    make(seed({ master: { status: "SCHEDULED" }, channels: [{ id: "c1", tenant_id: "t1", master_campaign_id: M, status: "FAILED" }] }));
    await cancelSubmissionAction(form());
    expect(writes()).toHaveLength(0);
    expect(statuses("prompter_channel_campaigns")).toEqual(["FAILED"]);
  });

  it("loses a race to an approval (master flips to SCHEDULED just before the write): nothing else is changed", async () => {
    make(seed({ channels: [{ id: "c1", tenant_id: "t1", master_campaign_id: M, status: "FAILED" }] }), {
      beforeExec: ({ table, op, db: d }) => {
        if (table === "prompter_master_campaigns" && op === "update") d.tables.prompter_master_campaigns[0].status = "SCHEDULED";
      },
    });
    await cancelSubmissionAction(form());
    expect(statuses("prompter_master_campaigns")).toEqual(["SCHEDULED"]);
    expect(statuses("prompter_channel_campaigns")).toEqual(["FAILED"]);
    expect(statuses("prompter_approvals")).toEqual(["PENDING"]);
  });

  it("another tenant's campaign is not touched", async () => {
    make(seed({ master: { tenant_id: "t2" } }));
    await cancelSubmissionAction(form());
    expect(writes()).toHaveLength(0);
  });
});
