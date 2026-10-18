import { describe, expect, it } from "vitest";
import {
  STATUS_TRANSITIONS,
  checkChannelCampaignState,
  isMirrorConfirmed,
  mirrorChannelCampaignStatus,
  transitionMasterCampaign,
  type StatusTransition,
} from "@/services/channel-campaigns";
import { createFakeDb, type Row } from "../helpers/stateful-fake-db";

const ALL = ["DRAFT", "AWAITING_APPROVAL", "SCHEDULED", "ACTIVE", "PAUSED", "COMPLETED", "FAILED"] as const;
const LOCKED = ["FAILED", "ACTIVE", "PAUSED", "COMPLETED"] as const;
const TRANSITIONS = Object.keys(STATUS_TRANSITIONS) as StatusTransition[];
const T1 = "11111111-1111-1111-1111-111111111111";
const T2 = "22222222-2222-2222-2222-222222222222";
const M = "m1";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asClient = (db: { from: unknown }) => db as any;

describe("H1 transition table", () => {
  it("is exactly the four legitimate ordinary transitions", () => {
    expect(STATUS_TRANSITIONS).toEqual({
      SUBMIT: { from: "DRAFT", to: "AWAITING_APPROVAL" },
      CANCEL: { from: "AWAITING_APPROVAL", to: "DRAFT" },
      APPROVE: { from: "AWAITING_APPROVAL", to: "SCHEDULED" },
      REJECT: { from: "AWAITING_APPROVAL", to: "DRAFT" },
    });
  });

  it("never uses FAILED/ACTIVE/PAUSED/COMPLETED as a source or a target", () => {
    for (const { from, to } of Object.values(STATUS_TRANSITIONS)) {
      expect(LOCKED).not.toContain(from);
      expect(LOCKED).not.toContain(to);
    }
  });

  it("is immutable", () => {
    expect(Object.isFrozen(STATUS_TRANSITIONS)).toBe(true);
    expect(Object.isFrozen(STATUS_TRANSITIONS.APPROVE)).toBe(true);
  });
});

describe.each(TRANSITIONS)("%s — every source status", (transition) => {
  const { from, to } = STATUS_TRANSITIONS[transition];

  it.each(ALL)("channel row in %s", async (status) => {
    const db = createFakeDb({
      prompter_channel_campaigns: [{ id: "c1", tenant_id: T1, master_campaign_id: M, channel: "FACEBOOK", status }],
      prompter_master_campaigns: [{ id: M, tenant_id: T1, status: "AWAITING_APPROVAL", channels: ["FACEBOOK"] }],
    });
    const result = await mirrorChannelCampaignStatus(asClient(db), T1, M, transition);
    const expected = status === from ? to : status;
    expect(db.tables.prompter_channel_campaigns[0].status).toBe(expected);
    expect(result.ok).toBe(true);
    expect(result.updated).toBe(status === from ? 1 : 0);
    // Zero rows moved is only "confirmed" when the resulting state really agrees (target or locked).
    const locked = (LOCKED as readonly string[]).includes(status);
    expect(result.consistent).toBe(status === from || status === to || locked);
    expect(isMirrorConfirmed(result)).toBe(result.consistent);
  });

  it.each(ALL)("master row in %s", async (status) => {
    const db = createFakeDb({ prompter_master_campaigns: [{ id: M, tenant_id: T1, status }] });
    const moved = await transitionMasterCampaign(asClient(db), T1, M, transition);
    expect(moved).toBe(status === from ? "moved" : "conflict");
    expect(db.tables.prompter_master_campaigns[0].status).toBe(status === from ? to : status);
  });

  it("a mixed set only moves the rows in the source status; locked rows are untouched", async () => {
    const rows: Row[] = ALL.map((status, i) => ({ id: `c${i}`, tenant_id: T1, master_campaign_id: M, channel: `CH${i}`, status }));
    const db = createFakeDb({ prompter_channel_campaigns: rows, prompter_master_campaigns: [{ id: M, tenant_id: T1, channels: [] }] });
    await mirrorChannelCampaignStatus(asClient(db), T1, M, transition);
    for (const r of db.tables.prompter_channel_campaigns) {
      const original = ALL[Number(String(r.id).slice(1))];
      expect(r.status).toBe(original === from ? to : original);
      if ((LOCKED as readonly string[]).includes(original)) expect(r.status).toBe(original);
    }
  });

  it("tenant isolation: another tenant's rows (same master id) are never changed", async () => {
    const db = createFakeDb({
      prompter_channel_campaigns: [{ id: "c1", tenant_id: T2, master_campaign_id: M, channel: "FACEBOOK", status: from }],
      prompter_master_campaigns: [{ id: M, tenant_id: T2, status: from, channels: ["FACEBOOK"] }],
    });
    expect(await transitionMasterCampaign(asClient(db), T1, M, transition)).toBe("conflict");
    // Another tenant's master is invisible: the verification read cannot answer, so it is NOT confirmed.
    const mirror = await mirrorChannelCampaignStatus(asClient(db), T1, M, transition);
    expect(mirror.updated).toBe(0);
    expect(isMirrorConfirmed(mirror)).toBe(false);
    expect(db.tables.prompter_channel_campaigns[0].status).toBe(from);
    expect(db.tables.prompter_master_campaigns[0].status).toBe(from);
  });

  it("every statement carries the id/master filter, the tenant filter and the source-status filter", async () => {
    const db = createFakeDb({ prompter_channel_campaigns: [], prompter_master_campaigns: [] });
    await transitionMasterCampaign(asClient(db), T1, M, transition);
    await mirrorChannelCampaignStatus(asClient(db), T1, M, transition);
    const updates = db.log.filter((s) => s.op === "update");
    expect(updates).toHaveLength(2);
    expect(updates[0].filters).toEqual([["id", M], ["tenant_id", T1], ["status", from]]);
    expect(updates[1].filters).toEqual([["master_campaign_id", M], ["tenant_id", T1], ["status", from]]);
    expect(updates.every((s) => s.payload?.status === to)).toBe(true);
    // The read-back verification is tenant-scoped too.
    for (const read of db.log.filter((s) => s.op === "select")) {
      expect(read.filters).toContainEqual(["tenant_id", T1]);
    }
  });

  it("a database error or a throw reports failure and writes nothing", async () => {
    for (const mode of ["error", "throw"] as const) {
      const db = createFakeDb(
        {
          prompter_channel_campaigns: [{ id: "c1", tenant_id: T1, master_campaign_id: M, channel: "FACEBOOK", status: from }],
          prompter_master_campaigns: [{ id: M, tenant_id: T1, status: from, channels: ["FACEBOOK"] }],
        },
        mode === "error"
          ? { failWhen: () => "boom secret" }
          : { throwWhen: () => true },
      );
      expect(await transitionMasterCampaign(asClient(db), T1, M, transition)).toBe("error");
      expect(await mirrorChannelCampaignStatus(asClient(db), T1, M, transition)).toEqual({ ok: false, updated: 0, consistent: false });
      expect(db.tables.prompter_channel_campaigns[0].status).toBe(from);
      expect(db.tables.prompter_master_campaigns[0].status).toBe(from);
    }
  });
});

describe("master transition fails closed on an ambiguous result", () => {
  it("two matching rows (should be impossible) is not success", async () => {
    const db = createFakeDb({
      prompter_master_campaigns: [
        { id: M, tenant_id: T1, status: "AWAITING_APPROVAL" },
        { id: M, tenant_id: T1, status: "AWAITING_APPROVAL" },
      ],
    });
    expect(await transitionMasterCampaign(asClient(db), T1, M, "APPROVE")).toBe("error");
  });

  it("distinguishes a status conflict (no row matched) from a database failure (outcome unknown)", async () => {
    const seed = { prompter_master_campaigns: [{ id: M, tenant_id: T1, status: "SCHEDULED" }] };
    expect(await transitionMasterCampaign(asClient(createFakeDb(seed)), T1, M, "APPROVE")).toBe("conflict");
    const failing = createFakeDb(seed, { failWhen: () => "boom" });
    expect(await transitionMasterCampaign(asClient(failing), T1, M, "APPROVE")).toBe("error");
    const throwing = createFakeDb(seed, { throwWhen: () => true });
    expect(await transitionMasterCampaign(asClient(throwing), T1, M, "APPROVE")).toBe("error");
  });
});

describe("F1 — a zero-row mirror is only success when the channel state really agrees", () => {
  const master = (channels: string[]) => ({ id: M, tenant_id: T1, status: "SCHEDULED", channels });
  const row = (id: string, channel: string, status: string): Row => ({ id, tenant_id: T1, master_campaign_id: M, channel, status });

  it("legitimate zero rows: every row already SCHEDULED or locked -> confirmed", async () => {
    const db = createFakeDb({
      prompter_master_campaigns: [master(["FACEBOOK", "INSTAGRAM", "TIKTOK"])],
      prompter_channel_campaigns: [row("a", "FACEBOOK", "SCHEDULED"), row("b", "INSTAGRAM", "FAILED"), row("c", "TIKTOK", "ACTIVE")],
    });
    const r = await mirrorChannelCampaignStatus(asClient(db), T1, M, "APPROVE");
    expect(r).toEqual({ ok: true, updated: 0, consistent: true });
    expect(isMirrorConfirmed(r)).toBe(true);
  });

  it("zero rows moved while a DRAFT row remains under an approved master -> NOT confirmed, and the DRAFT row is not re-armed", async () => {
    const db = createFakeDb({
      prompter_master_campaigns: [master(["FACEBOOK", "INSTAGRAM"])],
      prompter_channel_campaigns: [row("a", "FACEBOOK", "DRAFT"), row("b", "INSTAGRAM", "DRAFT")],
    });
    const r = await mirrorChannelCampaignStatus(asClient(db), T1, M, "APPROVE");
    expect(r).toEqual({ ok: true, updated: 0, consistent: false });
    expect(isMirrorConfirmed(r)).toBe(false);
    expect(db.tables.prompter_channel_campaigns.map((x) => x.status)).toEqual(["DRAFT", "DRAFT"]); // no DRAFT -> SCHEDULED path
  });

  it("a selected channel with no row at all (missing expected row) -> NOT confirmed", async () => {
    const db = createFakeDb({
      prompter_master_campaigns: [master(["FACEBOOK", "INSTAGRAM"])],
      prompter_channel_campaigns: [row("a", "FACEBOOK", "SCHEDULED")],
    });
    expect(isMirrorConfirmed(await mirrorChannelCampaignStatus(asClient(db), T1, M, "APPROVE"))).toBe(false);
  });

  it("partial: some rows moved, one row left in the wrong state -> NOT confirmed", async () => {
    const db = createFakeDb({
      prompter_master_campaigns: [master(["FACEBOOK", "INSTAGRAM"])],
      prompter_channel_campaigns: [row("a", "FACEBOOK", "AWAITING_APPROVAL"), row("b", "INSTAGRAM", "DRAFT")],
    });
    const r = await mirrorChannelCampaignStatus(asClient(db), T1, M, "APPROVE");
    expect(r.updated).toBe(1);
    expect(isMirrorConfirmed(r)).toBe(false);
  });

  it("the verification read failing means 'unknown' -> NOT confirmed (fail closed)", async () => {
    const db = createFakeDb(
      { prompter_master_campaigns: [master(["FACEBOOK"])], prompter_channel_campaigns: [row("a", "FACEBOOK", "AWAITING_APPROVAL")] },
      { failWhen: ({ table, op }) => (op === "select" && table === "prompter_channel_campaigns" ? "boom" : null) },
    );
    const r = await mirrorChannelCampaignStatus(asClient(db), T1, M, "APPROVE");
    expect(r.ok).toBe(false);
    expect(isMirrorConfirmed(r)).toBe(false);
  });

  it("pre-flight (phase before) accepts source or target status plus locked ones, nothing else", async () => {
    const mk = (status: string) =>
      createFakeDb({ prompter_master_campaigns: [master(["FACEBOOK"])], prompter_channel_campaigns: [row("a", "FACEBOOK", status)] });
    for (const status of ALL) {
      const r = await checkChannelCampaignState(asClient(mk(status)), T1, M, "APPROVE", "before");
      const ok = status === "AWAITING_APPROVAL" || status === "SCHEDULED" || (LOCKED as readonly string[]).includes(status);
      expect(r).toEqual({ ok: true, consistent: ok });
    }
  });

  it("an empty channel set (no rows, none selected) is a legitimate zero", async () => {
    const db = createFakeDb({ prompter_master_campaigns: [master([])], prompter_channel_campaigns: [] });
    expect(isMirrorConfirmed(await mirrorChannelCampaignStatus(asClient(db), T1, M, "APPROVE"))).toBe(true);
  });
});

describe("the exact re-arm defect (negative control)", () => {
  it("the OLD unfiltered mirror would rewrite a claimed FAILED channel back to SCHEDULED; the new one does not", async () => {
    const seed = {
      prompter_channel_campaigns: [
        { id: "c1", tenant_id: T1, master_campaign_id: M, status: "FAILED" },
        { id: "c2", tenant_id: T1, master_campaign_id: M, status: "ACTIVE" },
      ],
    };
    const old = createFakeDb(seed);
    // Old behaviour: update status by master id only (no tenant, no source status).
    await (old.from("prompter_channel_campaigns") as { update: (p: Row) => { eq: (c: string, v: unknown) => Promise<unknown> } })
      .update({ status: "SCHEDULED" })
      .eq("master_campaign_id", M);
    expect(old.tables.prompter_channel_campaigns.map((r) => r.status)).toEqual(["SCHEDULED", "SCHEDULED"]); // re-armed!

    const fixed = createFakeDb(seed);
    await mirrorChannelCampaignStatus(asClient(fixed), T1, M, "APPROVE");
    expect(fixed.tables.prompter_channel_campaigns.map((r) => r.status)).toEqual(["FAILED", "ACTIVE"]);
  });
});
