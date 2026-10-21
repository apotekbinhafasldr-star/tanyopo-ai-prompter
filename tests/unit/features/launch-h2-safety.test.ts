import { describe, expect, it, vi, beforeEach } from "vitest";
import { ConnectorApiError } from "@/lib/connectors/types";
import {
  makeAdminStorage,
  makePreflightFixtures,
  preflightTable,
  type PreflightFixtures,
} from "../helpers/meta-preflight-fixtures";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// The S1 gate is default-deny in production. These tests exercise the claim
// and partial-failure logic PAST the gate, so they simulate an open gate by
// mocking only its verdict. The real default-deny gate is covered in
// launch-claim-s1-gate.test.ts with no gate mock.
vi.mock("@/lib/campaigns/external-budget-guard", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/campaigns/external-budget-guard")>();
  return {
    ...real,
    isBudgetWritePlatformEnabled: () => true,
    evaluateExternalBudgetWrite: () => ({ allowed: true as const }),
  };
});
vi.mock("@/lib/campaigns/meta-objective-contracts", async (importOriginal) => {
  const helpers = await import("../helpers/meta-preflight-fixtures");
  return helpers.verifiedContracts(importOriginal as () => Promise<typeof import("@/lib/campaigns/meta-objective-contracts")>);
});
vi.mock("@/services/automation-settings", () => ({ readEmergencyStopStrict: vi.fn(async () => false) }));
import { readEmergencyStopStrict } from "@/services/automation-settings";
const stopMock = readEmergencyStopStrict as unknown as ReturnType<typeof vi.fn>;

const { sessionRef } = vi.hoisted(() => ({
  sessionRef: { current: { tenantId: "t1", userId: "u1", role: "owner" } },
}));
vi.mock("@/services/session", () => ({ requireSessionContext: vi.fn(async () => sessionRef.current) }));
vi.mock("@/lib/crypto/token-cipher", () => ({ decryptToken: vi.fn(() => "access-token-abc") }));

const { connectorMock } = vi.hoisted(() => ({
  connectorMock: {
    createCampaign: vi.fn(),
    createAdSet: vi.fn(),
    createCreative: vi.fn(),
    createAd: vi.fn(),
  },
}));
vi.mock("@/lib/connectors/get-connector", () => ({ getConnector: vi.fn(() => connectorMock) }));

interface Row {
  id: string;
  tenant_id: string;
  status: string;
  error: string | null;
  external_campaign_id: string | null;
}

interface Db {
  row: Row;
  updates: { patch: Record<string, unknown>; applied: boolean; filters: Record<string, unknown> }[];
  audits: Record<string, unknown>[];
  /** Return true to make the nth progress/final update (after the claim) fail with a DB error. */
  failUpdate: (patch: Record<string, unknown>, index: number) => boolean;
  /** Runs just before a conditional update is evaluated (to simulate a concurrent change). */
  beforeWrite?: (patch: Record<string, unknown>, filters: Record<string, unknown>) => Promise<void> | void;
}

const events: string[] = [];

let db: Db;
let fx: PreflightFixtures;
let auditMode: "ok" | "error" | "throw" = "ok";
let masterOverrides: Record<string, unknown> = {};
let accountOverrides: Record<string, unknown> = {};

function freshDb(overrides: Partial<Row> = {}): Db {
  return {
    row: { id: "cc1", tenant_id: "t1", status: "SCHEDULED", error: null, external_campaign_id: null, ...overrides },
    updates: [],
    audits: [],
    failUpdate: () => false,
  };
}

/** Stateful fake: an UPDATE ... WHERE is applied atomically at execution time. */
function updateBuilder(patch: Record<string, unknown>) {
  const filters: Record<string, unknown> = {};
  const builder = {
    eq(column: string, value: unknown) {
      filters[column] = value;
      return builder;
    },
    async select() {
      await Promise.resolve(); // yield, so concurrent callers interleave
      const index = db.updates.length;
      if (db.beforeWrite) await db.beforeWrite(patch, filters);
      if (db.failUpdate(patch, index)) {
        db.updates.push({ patch, applied: false, filters: { ...filters } });
        return { data: null, error: { code: "XX000" } };
      }
      const matches = Object.entries(filters).every(([column, value]) => (db.row as unknown as Record<string, unknown>)[column] === value);
      if (matches) Object.assign(db.row, patch);
      db.updates.push({ patch, applied: matches, filters: { ...filters } });
      events.push(matches ? "write" : "write-lost");
      return { data: matches ? [{ id: db.row.id }] : [], error: null };
    },
  };
  return builder;
}

const CHANNEL_ROWS = [
  { id: "cc1", channel: "FACEBOOK", budget_percentage: 50 },
  { id: "cc2", channel: "INSTAGRAM", budget_percentage: 50 },
];

const from = vi.fn((table: string) => {
  switch (table) {
    case "prompter_channel_campaigns":
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({
                data: { id: "cc1", channel: "FACEBOOK", master_campaign_id: "mc1" },
                error: null,
              }),
              then: (resolve: (v: unknown) => unknown) => resolve({ data: CHANNEL_ROWS, error: null }),
            }),
          }),
        }),
        update: (patch: Record<string, unknown>) => updateBuilder(patch),
      };
    case "prompter_master_campaigns":
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: "mc1",
                  status: "SCHEDULED",
                  name: "Promo",
                  objective: "BRAND_AWARENESS",
                  product_id: "p1",
                  target_country: "Indonesia",
                  selected_media_id: null,
                  ...masterOverrides,
                  currency: "IDR",
                  daily_budget: 100000,
                  total_budget: null,
                  ai_proposal: { headline: "H", primary_text: "P", cta: "C" },
                },
                error: null,
              }),
            }),
          }),
        }),
      };
    case "prompter_budget_policies":
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
    case "prompter_connected_accounts":
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "acct1",
                  external_account_id: "act_1",
                  status: "CONNECTED",
                  selected_page_id: "page_1",
                  ...accountOverrides,
                },
                error: null,
              }),
            }),
          }),
        }),
      };
    case "prompter_audit_logs":
      return {
        insert: async (row: Record<string, unknown>) => {
          if (auditMode === "throw") throw new Error("audit write exploded");
          if (auditMode === "error") return { error: { code: "XX000" } };
          db.audits.push(row);
          return { error: null };
        },
      };
    default: {
      const preflight = preflightTable(table, fx);
      if (preflight) return preflight;
      throw new Error(`Unexpected table: ${table}`);
    }
  }
});

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ from })) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    storage: makeAdminStorage(fx),
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { encrypted_access_token: "cipher" }, error: null }) }) }),
      }),
    }),
  })),
}));

import { launchChannelCampaignAction } from "@/features/campaigns/launch-actions";

const ALREADY = "Campaign ini sudah diluncurkan atau sedang diproses oleh permintaan lain.";

function metaCalls() {
  return (
    connectorMock.createCampaign.mock.calls.length +
    connectorMock.createAdSet.mock.calls.length +
    connectorMock.createCreative.mock.calls.length +
    connectorMock.createAd.mock.calls.length
  );
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.linoe.id");
  vi.stubEnv("META_REDIRECT_URI", "");
  fx = makePreflightFixtures();
  masterOverrides = {};
  accountOverrides = {};
  auditMode = "ok";
  db = freshDb();
  events.length = 0;
  stopMock.mockReset().mockImplementation(async () => {
    events.push("stop-read");
    return false;
  });
  sessionRef.current = { tenantId: "t1", userId: "u1", role: "owner" };
  connectorMock.createCampaign.mockReset().mockImplementation(async () => (events.push("create:campaign"), { id: "ext_campaign_1" }));
  connectorMock.createAdSet.mockReset().mockImplementation(async () => (events.push("create:adset"), { id: "ext_adset_1" }));
  connectorMock.createCreative.mockReset().mockImplementation(async () => (events.push("create:creative"), { id: "ext_creative_1" }));
  connectorMock.createAd.mockReset().mockImplementation(async () => (events.push("create:ad"), { id: "ext_ad_1" }));
});


const NOTE_RE = /\[LNE:([0-9a-f-]{36})\]/;
const STEPS = [
  { name: "createCampaign", fn: "createCampaign", token: "C" },
  { name: "createAdSet", fn: "createAdSet", token: "S" },
  { name: "createCreative", fn: "createCreative", token: "R" },
  { name: "createAd", fn: "createAd", token: "A" },
] as const;
const CREATE_FNS = ["createCampaign", "createAdSet", "createCreative", "createAd"] as const;

function nonceOf(note: string | null): string {
  const m = NOTE_RE.exec(note ?? "");
  expect(m, `no nonce in note: ${note}`).not.toBeNull();
  return m![1];
}

/** The strict reader answers `false` for its first `n` calls (call 1 is the pre-claim gate), then `then`. */
function stopAfter(n: number, then: boolean | null | "throw") {
  let calls = 0;
  stopMock.mockReset().mockImplementation(async () => {
    calls++;
    events.push("stop-read");
    if (calls <= n) return false;
    if (then === "throw") throw new Error("settings read exploded");
    return then;
  });
}

describe("H2-B: Emergency Stop is re-read immediately before every create", () => {
  it("success path: intent write, strict stop read, create — in that order, four times", async () => {
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toBeNull();
    const seq = events.filter((e) => e !== "write-lost");
    // gate read, claim write, then per step: intent write, stop read, create, result write (the ad's result is the final write)
    expect(seq).toEqual([
      "stop-read",
      "write",
      "write", "stop-read", "create:campaign", "write",
      "write", "stop-read", "create:adset", "write",
      "write", "stop-read", "create:creative", "write",
      "write", "stop-read", "create:ad",
      "write",
    ]);
  });

  for (const [index, step] of STEPS.entries()) {
    for (const mode of [true, null, "throw"] as const) {
      it(`${step.name}: stop ${mode === true ? "ACTIVE" : mode === null ? "unreadable (null)" : "read throws"} → no create, no later create, row stays FAILED, ids preserved`, async () => {
        stopAfter(1 + index, mode);
        const result = await launchChannelCampaignAction("cc1");

        // creates before this boundary happened exactly once; this one and later did not
        CREATE_FNS.forEach((fn, i) => {
          expect(connectorMock[fn], fn).toHaveBeenCalledTimes(i < index ? 1 : 0);
        });
        expect(result.error).not.toBeNull();
        expect(result.error).toContain("dihentikan");
        expect(result.error).toContain("Peluncuran ulang diblokir");
        expect(db.row.status).toBe("FAILED"); // fail closed, even before the first create
        expect(db.row.status).not.toBe("SCHEDULED");
        if (index > 0) expect(db.row.external_campaign_id).toBe("ext_campaign_1"); // known id preserved
        else expect(db.row.external_campaign_id).toBeNull();
        expect(db.audits.find((a) => a.action === "campaign.launch_failed")?.context).toMatchObject({
          certainty: "NOT_ATTEMPTED",
          failed_step: step.name,
          released_for_retry: false,
        });
        // no object is ever deleted or recreated: only the four create fns exist on the connector
        expect(Object.keys(connectorMock).sort()).toEqual([...CREATE_FNS].sort());
        // no automatic retry: after the stop clears, a second request is still refused
        stopMock.mockReset().mockResolvedValue(false);
        expect(await launchChannelCampaignAction("cc1")).toEqual({ error: ALREADY });
        CREATE_FNS.forEach((fn, i) => {
          expect(connectorMock[fn], fn).toHaveBeenCalledTimes(i < index ? 1 : 0);
        });
      });
    }
  }

  it("a stop that arrives between two creates keeps every earlier id in the row and the message", async () => {
    stopAfter(3, true); // gate, campaign, ad set pass; creative boundary stops
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toContain("campaign=ext_campaign_1, adset=ext_adset_1");
    expect(db.row.error).toContain("campaign=ext_campaign_1, adset=ext_adset_1");
    expect(db.row.external_campaign_id).toBe("ext_campaign_1");
    expect(connectorMock.createCreative).not.toHaveBeenCalled();
    expect(connectorMock.createAd).not.toHaveBeenCalled();
  });
});

describe("H2-A: durable create intent and correlation tokens", () => {
  it("the intent for each step is stored (with its token and the nonce) BEFORE that create", async () => {
    const seenAtCreate: { note: string | null }[] = [];
    const ids = { createCampaign: "ext_campaign_1", createAdSet: "ext_adset_1", createCreative: "ext_creative_1", createAd: "ext_ad_1" };
    for (const fn of CREATE_FNS) {
      connectorMock[fn].mockReset().mockImplementation(async () => {
        seenAtCreate.push({ note: db.row.error });
        return { id: ids[fn] };
      });
    }
    await launchChannelCampaignAction("cc1");
    expect(seenAtCreate).toHaveLength(4);
    STEPS.forEach((step, i) => {
      expect(seenAtCreate[i].note, step.name).toContain(`LNE-`);
      expect(seenAtCreate[i].note, step.name).toMatch(new RegExp(`-${step.token}\\)`));
      expect(seenAtCreate[i].note, step.name).toContain("TIDAK PASTI");
    });
    // one nonce for the whole attempt
    expect(new Set(seenAtCreate.map((s) => nonceOf(s.note))).size).toBe(1);
  });

  it("Meta object names carry the short token for their own object type; the same attempt shares the prefix", async () => {
    await launchChannelCampaignAction("cc1");
    const names = [
      connectorMock.createCampaign.mock.calls[0][2].name,
      connectorMock.createAdSet.mock.calls[0][2].name,
      connectorMock.createCreative.mock.calls[0][2].name,
      connectorMock.createAd.mock.calls[0][2].name,
    ] as string[];
    const tags = names.map((n) => /\[LNE-([0-9A-F]{8})-([CSRA])\]$/.exec(n));
    tags.forEach((t) => expect(t).not.toBeNull());
    expect(tags.map((t) => t![2])).toEqual(["C", "S", "R", "A"]);
    expect(new Set(tags.map((t) => t![1])).size).toBe(1);
    expect(names[0].startsWith("Promo")).toBe(true);
    expect(names[1]).toContain("Ad Set");
    // the audit log records the attempt tag, never a secret
    const audit = db.audits.find((a) => a.action === "campaign.launched")!.context as Record<string, unknown>;
    expect(audit.correlation_token).toMatch(/^LNE-[0-9A-F]{8}-\*$/);
  });

  it("tokens differ between two attempts (a re-armed row gets a new nonce)", async () => {
    await launchChannelCampaignAction("cc1");
    const first = connectorMock.createCampaign.mock.calls[0][2].name as string;
    db.row = { ...db.row, status: "SCHEDULED", error: null, external_campaign_id: null };
    await launchChannelCampaignAction("cc1");
    const second = connectorMock.createCampaign.mock.calls[1][2].name as string;
    expect(second).not.toBe(first);
  });

  it("a very long master name is shortened but never loses the token; special characters pass through", async () => {
    masterOverrides = { name: `Promo "Besar" & <b>100%</b> (🔥) ${"x".repeat(900)}` };
    await launchChannelCampaignAction("cc1");
    for (const fn of CREATE_FNS) {
      const name = connectorMock[fn].mock.calls[0][2].name as string;
      expect(Array.from(name).length, fn).toBeLessThanOrEqual(200);
      expect(name, fn).toMatch(/\[LNE-[0-9A-F]{8}-[CSRA]\]$/);
    }
  });

  it("a failed intent write means NO create call for that step (any of the four)", async () => {
    for (const [index, step] of STEPS.entries()) {
      db = freshDb();
      events.length = 0;
      for (const fn of CREATE_FNS) connectorMock[fn].mockClear();
      let intentCount = 0;
      db.failUpdate = (patch) => {
        if (typeof patch.error === "string" && patch.error.includes("TIDAK PASTI")) {
          intentCount++;
          return intentCount === index + 1;
        }
        return false;
      };
      const result = await launchChannelCampaignAction("cc1");
      CREATE_FNS.forEach((fn, i) => expect(connectorMock[fn], `${step.name}/${fn}`).toHaveBeenCalledTimes(i < index ? 1 : 0));
      expect(result.error, step.name).not.toBeNull();
      expect(db.row.status, step.name).toBe("FAILED");
      expect(db.audits.find((a) => a.action === "campaign.launch_failed")?.context, step.name).toMatchObject({
        certainty: "NOT_ATTEMPTED",
        released_for_retry: false,
      });
    }
  });

  it("the intent write precedes the stop read (a stop is checked as late as possible)", async () => {
    await launchChannelCampaignAction("cc1");
    const i = events.indexOf("create:campaign");
    expect(events.slice(0, i)).toEqual(["stop-read", "write", "write", "stop-read"]);
  });

  it("timeout / uncertain outcome: one call, fail-closed, token and nonce in the row, no retry, no release", async () => {
    connectorMock.createAdSet.mockImplementation(async () => {
      events.push("create:adset");
      throw new ConnectorApiError("META", "timed out", {});
    });
    const result = await launchChannelCampaignAction("cc1");
    expect(connectorMock.createAdSet).toHaveBeenCalledTimes(1);
    expect(connectorMock.createCreative).not.toHaveBeenCalled();
    expect(result.error).toContain("TIDAK PASTI");
    expect(result.error).toMatch(/LNE-[0-9A-F]{8}-\*/);
    expect(db.row.status).toBe("FAILED");
    expect(db.row.external_campaign_id).toBe("ext_campaign_1");
    expect(NOTE_RE.test(db.row.error ?? "")).toBe(true);
    expect(await launchChannelCampaignAction("cc1")).toEqual({ error: ALREADY });
    expect(connectorMock.createAdSet).toHaveBeenCalledTimes(1);
  });

  it("a create answer without an id is UNCERTAIN, never repeated, and earlier ids stay", async () => {
    connectorMock.createCreative.mockResolvedValue({});
    const result = await launchChannelCampaignAction("cc1");
    expect(connectorMock.createCreative).toHaveBeenCalledTimes(1);
    expect(connectorMock.createAd).not.toHaveBeenCalled();
    expect(result.error).toContain("TIDAK PASTI");
    expect(db.row.external_campaign_id).toBe("ext_campaign_1");
    expect(db.row.error).toContain("adset=ext_adset_1");
  });

  it("an id that was received is kept in the failure write even if a later write fails (no null overwrite)", async () => {
    connectorMock.createAdSet.mockRejectedValue(new ConnectorApiError("META", "x", { status: 400 }));
    await launchChannelCampaignAction("cc1");
    const failure = db.updates.filter((u) => u.applied).at(-1)!;
    expect(failure.patch.status).toBe("FAILED");
    expect(failure.patch.external_campaign_id).toBe("ext_campaign_1");

    // when no id was received the failure patch does not touch the column at all
    db = freshDb();
    connectorMock.createCampaign.mockRejectedValue(new Error("socket hang up"));
    await launchChannelCampaignAction("cc1");
    const failure2 = db.updates.filter((u) => u.applied).at(-1)!;
    expect("external_campaign_id" in failure2.patch).toBe(false);
  });

  it("the release to SCHEDULED stays limited to a first-call 4xx with nothing created", async () => {
    connectorMock.createCampaign.mockRejectedValue(new ConnectorApiError("META", "x", { status: 400, code: 100 }));
    await launchChannelCampaignAction("cc1");
    expect(db.row).toMatchObject({ status: "SCHEDULED", error: null, external_campaign_id: null });

    db = freshDb();
    connectorMock.createCampaign.mockReset().mockResolvedValue({ id: "ext_campaign_1" });
    connectorMock.createAdSet.mockRejectedValue(new ConnectorApiError("META", "x", { status: 400 }));
    await launchChannelCampaignAction("cc1");
    expect(db.row.status).toBe("FAILED");
  });
});

describe("H2-C: every post-claim write is fenced by the attempt's own note", () => {
  it("each write after the claim carries id, tenant, status FAILED and the exact note the attempt wrote last", async () => {
    await launchChannelCampaignAction("cc1");
    const [claim, ...rest] = db.updates;
    expect(claim.filters).toEqual({ id: "cc1", tenant_id: "t1", status: "SCHEDULED" });
    const claimNote = claim.patch.error as string;
    expect(claimNote).toMatch(NOTE_RE);

    let expected = claimNote;
    expect(rest).toHaveLength(8); // 4 intents + 3 results + final
    for (const u of rest) {
      expect(u.applied).toBe(true);
      expect(u.filters).toEqual({ id: "cc1", tenant_id: "t1", status: "FAILED", error: expected });
      if (typeof u.patch.error === "string") {
        expect(nonceOf(u.patch.error)).toBe(nonceOf(claimNote));
        expected = u.patch.error;
      }
    }
    expect(Object.keys(rest.at(-1)!.patch).sort()).toEqual(["error", "status"]);
    expect(rest.at(-1)!.patch).toEqual({ status: "ACTIVE", error: null });
  });

  it("no write after the claim ever filters on updated_at only, or resets status broadly", async () => {
    await launchChannelCampaignAction("cc1");
    for (const u of db.updates) {
      expect(JSON.stringify(u.filters)).not.toContain("updated_at");
      expect(u.filters.id).toBe("cc1");
      expect(u.filters.tenant_id).toBe("t1");
    }
  });

  it("a stale writer (row re-armed and claimed by a newer attempt mid-flight) halts and writes nothing more", async () => {
    // after the campaign was created, a newer attempt B takes over the row
    connectorMock.createCampaign.mockImplementation(async () => {
      events.push("create:campaign");
      db.row = { ...db.row, status: "FAILED", error: "Peluncuran sedang diproses. [LNE:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb]", external_campaign_id: null };
      return { id: "ext_campaign_1" };
    });
    const result = await launchChannelCampaignAction("cc1");

    expect(connectorMock.createAdSet).not.toHaveBeenCalled();
    expect(connectorMock.createCreative).not.toHaveBeenCalled();
    expect(connectorMock.createAd).not.toHaveBeenCalled();
    expect(result.error).not.toBeNull();
    // B's row is untouched: not overwritten, no id from A, not released
    expect(db.row).toMatchObject({
      status: "FAILED",
      error: "Peluncuran sedang diproses. [LNE:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb]",
      external_campaign_id: null,
    });
    // after the lost write, A issued no failure/release write at all
    const writes = db.updates;
    expect(writes.at(-1)!.applied).toBe(false); // the single lost progress write
    expect(db.audits.find((a) => a.action === "campaign.launch_failed")?.context).toMatchObject({
      certainty: "FENCE_LOST",
      ownership_lost: true,
      status_recorded: false,
      released_for_retry: false,
    });
  });

  it("a manual re-arm (SCHEDULED) during a create makes the old worker halt; it cannot flip the row back to FAILED/ACTIVE", async () => {
    connectorMock.createAdSet.mockImplementation(async () => {
      events.push("create:adset");
      db.row = { ...db.row, status: "SCHEDULED", error: null, external_campaign_id: null };
      return { id: "ext_adset_1" };
    });
    const result = await launchChannelCampaignAction("cc1");
    expect(connectorMock.createCreative).not.toHaveBeenCalled();
    expect(connectorMock.createAd).not.toHaveBeenCalled();
    expect(result.error).not.toBeNull();
    expect(db.row).toMatchObject({ status: "SCHEDULED", error: null, external_campaign_id: null });
  });

  it("a failed release attempt of a stale 4xx writer cannot un-claim a newer attempt", async () => {
    connectorMock.createCampaign.mockImplementation(async () => {
      events.push("create:campaign");
      // newer attempt owns the row now
      db.row = { ...db.row, status: "FAILED", error: "other [LNE:cccccccc-cccc-4ccc-8ccc-cccccccccccc]" };
      throw new ConnectorApiError("META", "x", { status: 400 });
    });
    await launchChannelCampaignAction("cc1");
    expect(db.row.status).toBe("FAILED");
    expect(db.row.error).toBe("other [LNE:cccccccc-cccc-4ccc-8ccc-cccccccccccc]");
  });

  it("an intent write that finds the row changed halts with NO create and no failure write", async () => {
    db.beforeWrite = (patch) => {
      if (typeof patch.error === "string" && patch.error.includes("TIDAK PASTI") && !connectorMock.createCampaign.mock.calls.length) {
        db.row = { ...db.row, error: "diubah admin" };
      }
    };
    const result = await launchChannelCampaignAction("cc1");
    expect(metaCalls()).toBe(0);
    expect(result.error).not.toBeNull();
    expect(db.row.error).toBe("diubah admin");
    expect(db.row.status).toBe("FAILED");
  });

  it("two overlapping attempts on one row: only one ever calls Meta (claim), the loser writes nothing", async () => {
    const [a, b] = await Promise.all([launchChannelCampaignAction("cc1"), launchChannelCampaignAction("cc1")]);
    expect([a.error, b.error].filter((e) => e === ALREADY)).toHaveLength(1);
    expect(connectorMock.createCampaign).toHaveBeenCalledTimes(1);
    expect(db.updates.filter((u) => !u.applied)).toHaveLength(1); // only the loser's claim matched nothing
  });

  it("the database answering ambiguously (error) after the create preserves the id in the message and never ACTIVE", async () => {
    db.failUpdate = (patch) => typeof patch.error === "string" && patch.error.includes("adset=ext_adset_1");
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).toContain("adset=ext_adset_1");
    expect(connectorMock.createCreative).not.toHaveBeenCalled();
    expect(db.row.status).toBe("FAILED");
    expect(db.row.external_campaign_id).toBe("ext_campaign_1");
  });

  it("tenant isolation is preserved on every write", async () => {
    await launchChannelCampaignAction("cc1");
    expect(db.updates.every((u) => u.filters.tenant_id === "t1")).toBe(true);
  });

  it("the nonce is unpredictable and different on every launch attempt", async () => {
    const nonces: string[] = [];
    for (let i = 0; i < 5; i++) {
      db = freshDb();
      await launchChannelCampaignAction("cc1");
      nonces.push(nonceOf(db.updates[0].patch.error as string));
    }
    expect(new Set(nonces).size).toBe(5);
  });
});

describe("existing protections still hold with H2", () => {
  it("an Emergency Stop that is already active when the launch starts never reaches Meta and leaves the row FAILED (not SCHEDULED)", async () => {
    stopMock.mockReset().mockResolvedValue(true);
    const result = await launchChannelCampaignAction("cc1");
    expect(result.error).not.toBeNull();
    expect(metaCalls()).toBe(0);
    expect(db.row.status).toBe("FAILED");
    expect(db.row.status).not.toBe("SCHEDULED");
    expect(await launchChannelCampaignAction("cc1")).toEqual({ error: ALREADY });
  });

  it("an unreadable Emergency Stop from the start also never reaches Meta and stays fail-closed", async () => {
    stopMock.mockReset().mockResolvedValue(null);
    await launchChannelCampaignAction("cc1");
    expect(metaCalls()).toBe(0);
    expect(db.row.status).toBe("FAILED");
  });
});
