import { describe, expect, it, vi, beforeEach } from "vitest";
import { KOPI_ROBUSTA_IMPROVED, KOPI_ROBUSTA_SIMULASI } from "@/tests/fixtures/ai/kopi-robusta-aceh-simulasi";
import { buildCopySnapshot } from "@/lib/campaigns/copy-guard";

vi.mock("@/services/session", () => ({
  requireSessionContext: vi.fn(async () => ({ tenantId: "t1", userId: "u1", role: "owner" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/budget-guard", () => ({
  getOrCreateBudgetPolicy: vi.fn(async () => ({})),
  getMonthToDateSpend: vi.fn(async () => 0),
  checkBudgetGuard: vi.fn(() => ({ allowed: true, reason: null })),
}));

const { mirrorChannelCampaignStatusMock, readAllocationRowsMock } = vi.hoisted(() => ({
  mirrorChannelCampaignStatusMock: vi.fn(async () => ({ ok: true, updated: 1, consistent: true })),
  readAllocationRowsMock: vi.fn(),
}));
const VALID_ALLOCATION_ROWS = [
  { id: "cc1", channel: "FACEBOOK", budgetPercentage: 50 },
  { id: "cc2", channel: "INSTAGRAM", budgetPercentage: 50 },
];
vi.mock("@/services/channel-campaigns", () => ({
  syncChannelCampaigns: vi.fn(async () => undefined),
  readChannelAllocationRows: readAllocationRowsMock,
  mirrorChannelCampaignStatus: mirrorChannelCampaignStatusMock,
  transitionMasterCampaign: vi.fn(async () => "moved"),
  isMirrorConfirmed: (r: { ok: boolean; consistent: boolean }) => r.ok && r.consistent,
}));

interface Product {
  id: string;
  name: string;
  description: string | null;
  website_url: string | null;
}

/**
 * Table-dispatching Supabase mock, same shape as campaigns-actions.test.ts, plus a product row that the
 * submit action reads for the quality gate (name + description) and for the legacy landing-URL snapshot.
 */
function buildSupabase(opts: { aiProposal: unknown; product?: Product | null; productReadError?: boolean }) {
  const campaign = {
    id: "c1",
    status: "DRAFT",
    daily_budget: 100,
    total_budget: 1000,
    duration_days: 7,
    currency: "IDR",
    product_id: "p1",
    updated_at: "2026-10-25T00:00:00.000000+00:00",
    ai_proposal: opts.aiProposal,
  };
  const campaignSingle = vi.fn(async () => ({ data: campaign, error: null }));
  const campaignEq2 = vi.fn(() => ({ single: campaignSingle }));
  const campaignEq1 = vi.fn(() => ({ eq: campaignEq2 }));
  const campaignSelect = vi.fn(() => ({ eq: campaignEq1 }));
  // Compare-and-swap update used by updateCampaignCopyAction: applies the patch to the same in-memory row that
  // submit reads next, so "edit the copy, then submit again" runs through both real actions.
  const campaignUpdate = vi.fn((patch: Record<string, unknown>) => {
    const b: Record<string, unknown> = {};
    b.eq = () => b;
    b.select = async () => {
      Object.assign(campaign, patch);
      return { data: [{ id: "c1" }], error: null };
    };
    return b;
  });

  const approvalInsert = vi.fn(async () => ({ error: null }));
  const approvalDelete = vi.fn();
  const auditInsert = vi.fn(async () => ({ error: null }));

  // The submit action reads the product twice: first for the legacy landing URL snapshot, then for the gate.
  // `productReadError` makes only the SECOND read (the gate's) fail, so the gate's own failure path is exercised.
  let productReads = 0;
  const productResult = async () => {
    productReads += 1;
    return opts.productReadError && productReads >= 2
      ? { data: null, error: { message: "boom" } }
      : { data: opts.product ?? null, error: null };
  };
  const none = async () => ({ data: null, error: null });

  const from = vi.fn((table: string) => {
    if (table === "prompter_master_campaigns") return { select: campaignSelect, update: campaignUpdate };
    if (table === "prompter_approvals") return { insert: approvalInsert, delete: approvalDelete };
    if (table === "prompter_audit_logs") return { insert: auditInsert };
    if (table === "prompter_products") {
      return { select: () => ({ eq: () => ({ maybeSingle: productResult, eq: () => ({ maybeSingle: productResult }) }) }) };
    }
    if (table === "prompter_brand_profiles") {
      return { select: () => ({ eq: () => ({ maybeSingle: none, eq: () => ({ maybeSingle: none }) }) }) };
    }
    throw new Error(`unexpected table ${table}`);
  });
  const rpc = vi.fn(async () => ({ data: [{ allowed: true, reason: null }], error: null }));

  return { from, rpc, approvalInsert, approvalDelete, auditInsert, campaignUpdate };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => currentSupabase),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentSupabase: any;

import { submitForApprovalAction, updateCampaignCopyAction } from "@/features/campaigns/actions";

const PRODUCT: Product = {
  id: "p1",
  name: KOPI_ROBUSTA_SIMULASI.productName,
  description: KOPI_ROBUSTA_SIMULASI.knownFacts,
  website_url: null,
};

/** The grounded fixture proposal, deep-copied, with its first candidate's hook (and the active hook) replaced. */
function proposalWithHook(hook: string) {
  const p = JSON.parse(JSON.stringify(KOPI_ROBUSTA_IMPROVED));
  p.candidates[0].hook = hook;
  p.hook = hook;
  return p;
}

function expectNothingWritten() {
  expect(currentSupabase.approvalInsert).not.toHaveBeenCalled();
  expect(currentSupabase.approvalDelete).not.toHaveBeenCalled();
  expect(currentSupabase.rpc).not.toHaveBeenCalled();
  expect(currentSupabase.campaignUpdate).not.toHaveBeenCalled();
  expect(mirrorChannelCampaignStatusMock).not.toHaveBeenCalled();
  expect(currentSupabase.auditInsert).not.toHaveBeenCalled();
}

describe("submitForApprovalAction — Quality Gate enforced on the server (PR-5)", () => {
  beforeEach(() => {
    mirrorChannelCampaignStatusMock.mockClear();
    readAllocationRowsMock.mockReset();
    readAllocationRowsMock.mockResolvedValue({ ok: true, rows: VALID_ALLOCATION_ROWS });
  });

  it("refuses to submit when the channel allocation is inconsistent (F-01), before any approval exists", async () => {
    const bad: { ok: boolean; rows: { id: string; channel: string; budgetPercentage: number | null }[] }[] = [
      { ok: true, rows: [{ id: "cc1", channel: "FACEBOOK", budgetPercentage: 33.3 }, { id: "cc2", channel: "INSTAGRAM", budgetPercentage: 33.3 }] },
      { ok: true, rows: [{ id: "cc1", channel: "FACEBOOK", budgetPercentage: 100 }, { id: "cc2", channel: "INSTAGRAM", budgetPercentage: null }] },
      { ok: true, rows: [{ id: "cc1", channel: "FACEBOOK", budgetPercentage: 100 }, { id: "cc2", channel: "INSTAGRAM", budgetPercentage: 0 }] },
      { ok: true, rows: [] },
      { ok: false, rows: [] },
    ];
    for (const read of bad) {
      readAllocationRowsMock.mockResolvedValue(read);
      currentSupabase = buildSupabase({ aiProposal: KOPI_ROBUSTA_IMPROVED, product: PRODUCT });
      const result = await submitForApprovalAction("c1");
      expect(result.error).toBeTruthy();
      expect(result.error).toMatch(/alokasi budget/i);
      expectNothingWritten();
    }
  });

  it("the unmodified fixture proposal is accepted (baseline: the gate has no blocking issue)", async () => {
    currentSupabase = buildSupabase({ aiProposal: KOPI_ROBUSTA_IMPROVED, product: PRODUCT });

    const result = await submitForApprovalAction("c1");

    expect(result.error).toBeNull();
    expect(currentSupabase.approvalInsert).toHaveBeenCalledTimes(1);
    expect(currentSupabase.rpc).toHaveBeenCalledWith("fn_reserve_active_campaign_slot", { p_campaign_id: "c1" });
  });

  it("refuses a proposal with a financial claim: actionable Indonesian message, no approval, no status change", async () => {
    currentSupabase = buildSupabase({ aiProposal: proposalWithHook("Passive income dari kopi robusta"), product: PRODUCT });

    const result = await submitForApprovalAction("c1");

    expect(result.error).toMatch(/belum bisa diajukan/i);
    expect(result.error).toMatch(/merevisi|revisi copy/i);
    expect(result.error).toMatch(/buat ulang strategi/i);
    expect(result.error).toMatch(/ajukan lagi/i);
    expect(result.error).toContain("Passive income");
    expectNothingWritten();
  });

  it("refuses a special ad category (Meta special_ad_categories is not supported)", async () => {
    currentSupabase = buildSupabase({ aiProposal: proposalWithHook("Lowongan kerja barista kopi"), product: PRODUCT });

    const result = await submitForApprovalAction("c1");

    expect(result.error).toMatch(/special_ad_categories/);
    expect(result.error).toMatch(/belum mendukung/i);
    expectNothingWritten();
  });

  it("the product description does NOT excuse a financial claim or a special category", async () => {
    currentSupabase = buildSupabase({
      aiProposal: proposalWithHook("Pinjaman cepat untuk usaha kopi"),
      product: { ...PRODUCT, description: "Kami menawarkan pinjaman cepat dan lowongan kerja barista." },
    });

    const result = await submitForApprovalAction("c1");

    expect(result.error).toMatch(/belum bisa diajukan/i);
    expectNothingWritten();
  });

  it("a blocked proposal can be submitted after the copy is revised (same campaign, same action)", async () => {
    currentSupabase = buildSupabase({ aiProposal: proposalWithHook("Cepat kaya dengan kopi"), product: PRODUCT });
    const refused = await submitForApprovalAction("c1");
    expect(refused.error).toMatch(/belum bisa diajukan/i);
    expectNothingWritten();

    // The user edits the copy (a fresh read of the campaign returns the revised proposal).
    currentSupabase = buildSupabase({ aiProposal: proposalWithHook("Kopi pagi tanpa perut perih"), product: PRODUCT });
    const accepted = await submitForApprovalAction("c1");

    expect(accepted.error).toBeNull();
    expect(currentSupabase.approvalInsert).toHaveBeenCalledTimes(1);
    expect(currentSupabase.rpc).toHaveBeenCalledTimes(1);
  });

  it("also checks the active (top-level) copy the owner may have edited, not only candidates[]", async () => {
    const p = JSON.parse(JSON.stringify(KOPI_ROBUSTA_IMPROVED));
    p.headline = "Investasi kopi, untung besar";
    currentSupabase = buildSupabase({ aiProposal: p, product: PRODUCT });

    const result = await submitForApprovalAction("c1");

    expect(result.error).toMatch(/belum bisa diajukan/i);
    expectNothingWritten();
  });

  it("warning-level issues (false urgency, medical claim) do not block submission", async () => {
    currentSupabase = buildSupabase({ aiProposal: proposalWithHook("Stok terbatas, menyembuhkan lelah"), product: PRODUCT });

    const result = await submitForApprovalAction("c1");

    expect(result.error).toBeNull();
    expect(currentSupabase.approvalInsert).toHaveBeenCalledTimes(1);
  });

  it("a legacy proposal that cannot be parsed is 'cannot be assessed' (as on the page): clean copy is not refused for a gate reason", async () => {
    currentSupabase = buildSupabase({
      aiProposal: { headline: "Kopi Robusta Aceh", primary_text: "Kopi sangrai medium 200 gram", cta: "Lihat" },
      product: PRODUCT,
    });

    const result = await submitForApprovalAction("c1");

    expect(result.error).toBeNull();
    expect(currentSupabase.approvalInsert).toHaveBeenCalledTimes(1);
  });

  it("but an unparsable legacy proposal whose known active copy has a financial claim or special category is still refused", async () => {
    for (const aiProposal of [
      { headline: "Passive income", primary_text: "Kopi", cta: "Lihat" },
      { headline: "Kopi", primary_text: "Lowongan kerja barista", cta: "Lihat" },
    ]) {
      currentSupabase = buildSupabase({ aiProposal, product: PRODUCT });
      const result = await submitForApprovalAction("c1");
      expect(result.error).toMatch(/belum bisa diajukan/i);
      expectNothingWritten();
    }
  });

  it("an unparsable legacy proposal with a problem only in candidates[] (not editable) is not refused", async () => {
    currentSupabase = buildSupabase({
      aiProposal: { headline: "Kopi", primary_text: "Kopi sangrai", cta: "Lihat", candidates: [{ hook: "Passive income" }] },
      product: PRODUCT,
    });
    expect((await submitForApprovalAction("c1")).error).toBeNull();
  });

  it("a campaign without any stored proposal is refused (FIX-195: the launch would send fallback copy), with a recovery hint", async () => {
    currentSupabase = buildSupabase({ aiProposal: null, product: PRODUCT });

    const result = await submitForApprovalAction("c1");

    expect(result.error).toMatch(/teks iklan belum lengkap/);
    expect(result.error).toMatch(/Buat Ulang dengan AI/);
    expectNothingWritten();
  });

  it("when the product cannot be read, nothing is submitted (fail closed) and the user is told to retry", async () => {
    currentSupabase = buildSupabase({ aiProposal: KOPI_ROBUSTA_IMPROVED, product: PRODUCT, productReadError: true });

    const result = await submitForApprovalAction("c1");

    expect(result.error).toMatch(/Gagal membaca data produk/);
    expect(result.error).toMatch(/coba lagi/i);
    expectNothingWritten();
  });

  it("a problem only in an ALTERNATIVE candidate does not block submit when the active copy is clean", async () => {
    const p = JSON.parse(JSON.stringify(KOPI_ROBUSTA_IMPROVED));
    p.candidates[2].hook = "Passive income dari kopi";
    p.candidates[2].primary_text = `${p.candidates[2].primary_text} Lowongan kerja barista.`;
    currentSupabase = buildSupabase({ aiProposal: p, product: PRODUCT });

    const result = await submitForApprovalAction("c1");

    expect(result.error).toBeNull();
    expect(currentSupabase.approvalInsert).toHaveBeenCalledTimes(1);
  });

  it("a problem in candidates[0] that is also the active copy blocks (the active copy is what is launched)", async () => {
    currentSupabase = buildSupabase({ aiProposal: proposalWithHook("Passive income dari kopi"), product: PRODUCT });
    expect((await submitForApprovalAction("c1")).error).toMatch(/belum bisa diajukan/i);
    expectNothingWritten();
  });

  it("copy longer than the schema allows is refused by the length guard (message names the length, not the claim)", async () => {
    // Over-long primary_text makes the schema parse fail; the old fallback scanned only 2 rules and let this through.
    const long = `Hasil dijamin 100% ${"kopi ".repeat(130)}`;
    const p = JSON.parse(JSON.stringify(KOPI_ROBUSTA_IMPROVED));
    p.primary_text = long;
    currentSupabase = buildSupabase({ aiProposal: p, product: PRODUCT });
    const result = await submitForApprovalAction("c1");
    expect(result.error).toMatch(/melebihi batas panjang/);
    expect(result.error).not.toMatch(/diblokir/);
    expectNothingWritten();
  });

  it("over-long but otherwise clean active copy is refused with a clear message (fail closed)", async () => {
    for (const [field, size] of [["hook", 201], ["headline", 121], ["primary_text", 601], ["cta", 41]] as const) {
      const p = JSON.parse(JSON.stringify(KOPI_ROBUSTA_IMPROVED));
      p[field] = "a".repeat(size);
      currentSupabase = buildSupabase({ aiProposal: p, product: PRODUCT });
      const result = await submitForApprovalAction("c1");
      expect(result.error).toMatch(/melebihi batas panjang/);
      expect(result.error).toContain(`${size}/`);
      expectNothingWritten();
    }
  });

  it("updateCampaignCopyAction rejects over-long copy on the server and writes nothing", async () => {
    currentSupabase = buildSupabase({ aiProposal: KOPI_ROBUSTA_IMPROVED, product: PRODUCT });
    const limits = { hook: 200, headline: 120, primaryText: 600, cta: 40 };
    for (const field of Object.keys(limits) as (keyof typeof limits)[]) {
      const form = new FormData();
      form.set("hook", "h");
      form.set("headline", "j");
      form.set("primaryText", "p");
      form.set("cta", "c");
      form.set(field, "a".repeat(limits[field] + 1));
      const r = await updateCampaignCopyAction("c1", { error: null }, form);
      expect(r.error).toMatch(/melebihi batas panjang/);
    }
    expect(currentSupabase.campaignUpdate).not.toHaveBeenCalled();
  });

  it("updateCampaignCopyAction accepts copy exactly at the limits", async () => {
    currentSupabase = buildSupabase({ aiProposal: KOPI_ROBUSTA_IMPROVED, product: PRODUCT });
    const form = new FormData();
    form.set("hook", "a".repeat(200));
    form.set("headline", "a".repeat(120));
    form.set("primaryText", "a".repeat(600));
    form.set("cta", "a".repeat(40));
    expect((await updateCampaignCopyAction("c1", { error: null }, form)).error).toBeNull();
    expect(currentSupabase.campaignUpdate).toHaveBeenCalledTimes(1);
    const written = currentSupabase.campaignUpdate.mock.calls[0][0].ai_proposal;
    expect(written.hook).toBe("a".repeat(200));
    expect(written.headline).toBe("a".repeat(120));
    expect(written.primary_text).toBe("a".repeat(600));
    expect(written.cta).toBe("a".repeat(40));
  });

  it("no dead end: after updateCampaignCopyAction cleans the active copy, the same campaign can be submitted", async () => {
    const bad = JSON.parse(JSON.stringify(KOPI_ROBUSTA_IMPROVED));
    bad.hook = "Cepat kaya dengan kopi";
    bad.headline = "Passive income dari kopi";
    // candidates stay as generated (clean here); the owner can only edit the active fields.
    currentSupabase = buildSupabase({ aiProposal: bad, product: PRODUCT });

    const refused = await submitForApprovalAction("c1");
    expect(refused.error).toMatch(/belum bisa diajukan/i);
    expectNothingWritten();

    const form = new FormData();
    form.set("hook", "Kopi robusta untuk pagi yang kuat");
    form.set("headline", "Kopi Robusta Aceh sangrai medium");
    form.set("primaryText", bad.primary_text);
    form.set("cta", bad.cta);
    const edited = await updateCampaignCopyAction("c1", { error: null }, form);
    expect(edited.error).toBeNull();
    expect(currentSupabase.campaignUpdate).toHaveBeenCalledTimes(1);

    const accepted = await submitForApprovalAction("c1");
    expect(accepted.error).toBeNull();
    expect(currentSupabase.approvalInsert).toHaveBeenCalledTimes(1);
  });
});

describe("submitForApprovalAction — required active copy and the reduced check (FIX-195)", () => {
  beforeEach(() => {
    mirrorChannelCampaignStatusMock.mockClear();
  });

  const LEGACY_OK = { headline: "Kopi Robusta Aceh", primary_text: "Kopi sangrai medium 200 gram", cta: "Lihat" };

  it("P1: a missing, malformed or blank proposal is refused with the recovery path named", async () => {
    const cases: [string, unknown][] = [
      ["null", null],
      ["empty object", {}],
      ["string", "Kopi Robusta"],
      ["array", [LEGACY_OK]],
      ["headline is a number", { ...LEGACY_OK, headline: 123 }],
      ["headline empty", { ...LEGACY_OK, headline: "" }],
      ["headline whitespace", { ...LEGACY_OK, headline: "   " }],
      ["primary_text missing", { headline: LEGACY_OK.headline, cta: LEGACY_OK.cta }],
      ["primary_text whitespace", { ...LEGACY_OK, primary_text: " \n\t " }],
      ["cta missing", { headline: LEGACY_OK.headline, primary_text: LEGACY_OK.primary_text }],
      ["cta null", { ...LEGACY_OK, cta: null }],
      ["hook is a number", { ...LEGACY_OK, hook: 5 }],
    ];
    for (const [name, aiProposal] of cases) {
      currentSupabase = buildSupabase({ aiProposal, product: PRODUCT });
      const result = await submitForApprovalAction("c1");
      expect(result.error, name).toMatch(/teks iklan belum lengkap/);
      expect(result.error, name).toMatch(/editor/);
      expect(result.error, name).toMatch(/Buat Ulang dengan AI/);
      expectNothingWritten();
    }
  });

  it("P1: a proposal that parses against the schema but has an empty headline is refused too (the schema accepts \"\")", async () => {
    const p = JSON.parse(JSON.stringify(KOPI_ROBUSTA_IMPROVED));
    p.headline = "";
    currentSupabase = buildSupabase({ aiProposal: p, product: PRODUCT });
    expect((await submitForApprovalAction("c1")).error).toMatch(/teks iklan belum lengkap/);
    expectNothingWritten();
  });

  it("P1: a valid legacy-shaped proposal (required copy present, hook absent) still passes the reduced check", async () => {
    currentSupabase = buildSupabase({ aiProposal: LEGACY_OK, product: PRODUCT });
    expect((await submitForApprovalAction("c1")).error).toBeNull();
    expect(currentSupabase.approvalInsert).toHaveBeenCalledTimes(1);
  });

  it("P2: parse fails for another reason (no candidates), copy within limits, blocking claim in the headline: refused by the BLOCK rule, not the length guard", async () => {
    for (const headline of ["Passive income dari rumah", "Hasil dijamin 100%"]) {
      currentSupabase = buildSupabase({ aiProposal: { ...LEGACY_OK, headline }, product: PRODUCT });
      const result = await submitForApprovalAction("c1");
      expect(result.error).toMatch(/memuat hal yang diblokir/);
      expect(result.error).not.toMatch(/melebihi batas panjang/);
      expect(result.error).not.toMatch(/belum lengkap/);
      expectNothingWritten();
    }
  });

  it("P2: the three refusal paths have different messages (incomplete / too long / blocked)", async () => {
    const messages: string[] = [];
    for (const aiProposal of [
      { ...LEGACY_OK, headline: "" },
      { ...LEGACY_OK, primary_text: "a".repeat(601) },
      { ...LEGACY_OK, headline: "Passive income dari rumah" },
    ]) {
      currentSupabase = buildSupabase({ aiProposal, product: PRODUCT });
      messages.push(String((await submitForApprovalAction("c1")).error));
    }
    expect(messages[0]).toMatch(/belum lengkap/);
    expect(messages[1]).toMatch(/melebihi batas panjang/);
    expect(messages[2]).toMatch(/memuat hal yang diblokir/);
    expect(new Set(messages).size).toBe(3);
  });

  it("recovery: the copy editor repairs a null, empty or non-object proposal and the campaign can then be submitted", async () => {
    for (const aiProposal of [null, {}, "abc", [1, 2]]) {
      mirrorChannelCampaignStatusMock.mockClear(); // a previous iteration ended in a successful submit
      currentSupabase = buildSupabase({ aiProposal, product: PRODUCT });
      expect((await submitForApprovalAction("c1")).error).toMatch(/belum lengkap/);
      expectNothingWritten();

      const form = new FormData();
      form.set("hook", "Kopi robusta untuk pagi yang kuat");
      form.set("headline", "Kopi Robusta Aceh sangrai medium");
      form.set("primaryText", "Kopi sangrai medium 200 gram");
      form.set("cta", "Lihat");
      expect((await updateCampaignCopyAction("c1", { error: null }, form)).error).toBeNull();
      const written = currentSupabase.campaignUpdate.mock.calls[0][0].ai_proposal;
      expect(Object.keys(written).sort()).toEqual(["cta", "headline", "hook", "primary_text"]);

      expect((await submitForApprovalAction("c1")).error).toBeNull();
      expect(currentSupabase.approvalInsert).toHaveBeenCalledTimes(1);
    }
  });

  it("the approval records a fingerprint of the active copy (headline, primary_text, cta) for the launch to compare", async () => {
    currentSupabase = buildSupabase({ aiProposal: KOPI_ROBUSTA_IMPROVED, product: PRODUCT });
    expect((await submitForApprovalAction("c1")).error).toBeNull();
    const context = (currentSupabase.approvalInsert.mock.calls[0] as unknown as [{ context: Record<string, unknown> }])[0].context;
    expect(context.copy_snapshot).toEqual(buildCopySnapshot(KOPI_ROBUSTA_IMPROVED));
    expect(context.copy_snapshot).toMatchObject({ version: 1, algorithm: "sha256" });
  });
});
