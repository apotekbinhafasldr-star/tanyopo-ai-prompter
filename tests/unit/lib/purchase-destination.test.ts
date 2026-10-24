import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildPurchaseDestination,
  buildPurchaseDestinationFromForm,
  checkLaunchDestination,
  normalizeIndonesianWhatsapp,
  readStoredDestination,
  validateWebsiteUrl,
  withPurchaseDestination,
  withUtm,
} from "@/lib/campaigns/purchase-destination";
import { BUDGET_WRITE_ENABLED_PLATFORMS } from "@/lib/campaigns/external-budget-guard";
import { buildCampaignProposalPrompt } from "@/lib/ai/prompts";
import { selectCandidate } from "@/schemas/ai/campaign-proposal";
import { promoteWizardSchema, quickPromoteSchema } from "@/schemas/campaign";

const OWN = ["linoe.example.com", "abcd.supabase.co"];

describe("website destination", () => {
  it("accepts a valid HTTPS URL", () => {
    const r = validateWebsiteUrl("https://tokosaya.com/produk?a=1", OWN);
    expect(r.ok).toBe(true);
  });
  it.each([
    "http://tokosaya.com",
    "https://127.0.0.1/x",
    "https://localhost/x",
    "https://10.0.0.5/x",
    "https://192.168.1.1/",
    "https://intranet/",
    "https://user:pw@tokosaya.com/",
    "https://tokosaya.com:8443/",
    "https://linoe.example.com/x",
    "https://abcd.supabase.co/x",
    "https://tanyopo.ai/x",
    `https://tokosaya.com/${"a".repeat(2100)}`,
    "ftp://tokosaya.com",
    "javascript:alert(1)",
    "",
  ])("rejects %s", (u) => {
    expect(validateWebsiteUrl(u, OWN).ok).toBe(false);
  });
  it("does not leak the catalog-specific hint", () => {
    const r = validateWebsiteUrl("http://x.com", OWN);
    expect(r.ok === false && r.message).not.toMatch(/produk atau profil brand/);
  });
});

describe("WhatsApp normalisation", () => {
  it.each([
    ["08123456789", "628123456789"],
    ["+62 812-3456-789", "628123456789"],
    ["628123456789", "628123456789"],
    ["(0812) 3456 789", "628123456789"],
    ["https://wa.me/628123456789", "628123456789"],
    ["wa.me/628123456789", "628123456789"],
  ])("accepts %s", (input, expected) => {
    const r = normalizeIndonesianWhatsapp(input);
    expect(r).toEqual({ ok: true, value: expected });
  });
  it.each([
    "",
    "   ",
    "abc",
    "8123456789",
    "6208123456789",
    "+1 415 555 0100",
    "0212345678",
    "081234",
    "08111111111",
    "0812345678901234",
    "0812<script>",
    "https://evil.com/628123456789",
    "https://api.whatsapp.com/send?phone=628123456789",
    "081234+56789",
  ])("rejects %j", (input) => {
    expect(normalizeIndonesianWhatsapp(input).ok).toBe(false);
  });
  it("builds only an official wa.me link", () => {
    const r = buildPurchaseDestination({ type: "WHATSAPP", value: "08123456789" }, OWN);
    expect(r.ok && r.value.link).toBe("https://wa.me/628123456789");
  });
});

describe("build / form contract", () => {
  it("NONE has no value or link", () => {
    expect(buildPurchaseDestination({ type: "NONE" }, OWN)).toEqual({
      ok: true,
      value: { version: 1, type: "NONE", value: null, link: null },
    });
  });
  it("unknown type is rejected, but a missing form type becomes NONE", () => {
    expect(buildPurchaseDestination({ type: "TELEGRAM", value: "x" }, OWN).ok).toBe(false);
    const r = buildPurchaseDestinationFromForm(undefined, undefined, OWN);
    expect(r.ok && r.value.type).toBe("NONE");
  });
  it("never trusts a client supplied link: the link is derived from value", () => {
    const r = buildPurchaseDestination({ type: "WEBSITE", value: "https://tokosaya.com", link: "https://evil.com" } as never, OWN);
    expect(r.ok && r.value.link).toBe("https://tokosaya.com/");
  });
});

describe("stored destination / old campaigns / ai_proposal compatibility", () => {
  it("old campaign without the field is legacy and launch behaviour continues", () => {
    expect(readStoredDestination({ hook: "h" }, OWN)).toEqual({ kind: "legacy" });
    expect(readStoredDestination(null, OWN)).toEqual({ kind: "legacy" });
    expect(checkLaunchDestination({ hook: "h" }, OWN)).toEqual({ ok: true, mode: "legacy" });
  });
  it("campaign with NONE destination is refused for paid launch", () => {
    const none = buildPurchaseDestination({ type: "NONE" }, OWN);
    if (!none.ok) throw new Error("x");
    const r = checkLaunchDestination(withPurchaseDestination({ hook: "h" }, none.value), OWN);
    expect(r.ok).toBe(false);
  });
  it("tampered stored data is re-validated and refused", () => {
    const bad = { purchase_destination: { version: 1, type: "WEBSITE", value: "http://evil.com", link: "https://ok.com" } };
    expect(checkLaunchDestination(bad, OWN).ok).toBe(false);
    expect(checkLaunchDestination({ purchase_destination: "x" }, OWN).ok).toBe(false);
    expect(checkLaunchDestination({ purchase_destination: { type: "ZZZ" } }, OWN).ok).toBe(false);
  });
  it("withPurchaseDestination keeps every existing proposal key", () => {
    const wa = buildPurchaseDestination({ type: "WHATSAPP", value: "08123456789" }, OWN);
    if (!wa.ok) throw new Error("x");
    const out = withPurchaseDestination({ hook: "h", candidates: [1, 2] }, wa.value);
    expect(out.hook).toBe("h");
    expect(out.candidates).toEqual([1, 2]);
    expect(checkLaunchDestination(out, OWN)).toMatchObject({ ok: true, mode: "destination" });
  });
  it("selectCandidate (spread based) keeps the destination key", () => {
    const cand = (n: string) => ({ hook: n, headline: n, cta: n, primary_text: n, rationale: n });
    const proposal = { hook: "a", headline: "a", cta: "a", primary_text: "a", candidates: [cand("a"), cand("b")], purchase_destination: { version: 1, type: "NONE", value: null, link: null } };
    const out = selectCandidate(proposal as never, 1) as unknown as Record<string, unknown>;
    expect(out.purchase_destination).toEqual(proposal.purchase_destination);
    expect(out.hook).toBe("b");
  });
});

describe("UTM", () => {
  it("adds simple non-sensitive utm to websites and keeps query/fragment", () => {
    const r = withUtm("https://tokosaya.com/p?x=1#top", { campaignRef: "1234abcd-ffff" });
    expect(r.ok && r.value).toBe("https://tokosaya.com/p?x=1&utm_source=linoe&utm_medium=paid_social&utm_campaign=linoe-1234abcdffff#top");
  });
  it("never overrides seller utm", () => {
    const r = withUtm("https://tokosaya.com/?utm_source=mine", { campaignRef: "abc" });
    expect(r.ok && r.value).toContain("utm_source=mine");
    expect(r.ok && r.value).not.toContain("utm_source=linoe");
  });
  it("leaves wa.me links untouched", () => {
    expect(withUtm("https://wa.me/628123456789", { campaignRef: "abc" })).toEqual({ ok: true, value: "https://wa.me/628123456789" });
  });
  it("rejects when result is too long", () => {
    expect(withUtm(`https://tokosaya.com/${"a".repeat(1980)}`, { campaignRef: "abc" }).ok).toBe(false);
  });
});

describe("AI prompt", () => {
  const product = { name: "Kopi", product_type: "PHYSICAL", price: 1000, currency: "IDR", description: "d" } as never;
  const inputs = { objective: "SALES", channels: ["FACEBOOK"], targetCountry: null, targetRegion: null, targetCity: null, audienceNotes: null, dailyBudget: 1, totalBudget: null, currency: "IDR" };
  it("is byte-identical without a destination", () => {
    expect(buildCampaignProposalPrompt(product, inputs)).toBe(buildCampaignProposalPrompt(product, inputs, undefined));
    expect(buildCampaignProposalPrompt(product, inputs)).not.toMatch(/Tujuan pembelian/);
  });
  it("tells the AI not to invent URLs/numbers, and does not leak the number", () => {
    const p = buildCampaignProposalPrompt(product, inputs, { type: "WHATSAPP" });
    expect(p).toMatch(/WhatsApp/);
    expect(p).toMatch(/JANGAN menulis URL/);
    expect(p).not.toMatch(/628/);
  });
  it("NONE forbids promising checkout", () => {
    expect(buildCampaignProposalPrompt(product, inputs, { type: "NONE" })).toMatch(/JANGAN menjanjikan checkout/);
  });
});

describe("schemas / safety invariants", () => {
  const base = { productId: "6f1c2f3e-1f2a-4b6e-9c1d-0a1b2c3d4e5f", objective: "SALES", channels: ["FACEBOOK"], dailyBudget: 1 };
  it("old payloads without destination fields still parse", () => {
    expect(quickPromoteSchema.safeParse({ ...base }).success).toBe(true);
    expect(promoteWizardSchema.safeParse({ ...base }).success).toBe(true);
  });
  it("the paid-ad gate stays closed", () => {
    expect(BUDGET_WRITE_ENABLED_PLATFORMS).toEqual([]);
  });
  it("launch order: budget gate first, destination refusal before claim; no gate/billing/quota edits", () => {
    const src = readFileSync(path.join(process.cwd(), "features/campaigns/launch-actions.ts"), "utf8");
    const gate = src.indexOf("isBudgetWritePlatformEnabled(connectorPlatform)");
    const dest = src.indexOf("earlyDestination");
    const claim = src.indexOf("claim", dest);
    expect(gate).toBeGreaterThan(-1);
    expect(dest).toBeGreaterThan(gate);
    expect(claim).toBeGreaterThan(dest);
  });
  it("destination code touches no billing, trial or AI quota", () => {
    const src = readFileSync(path.join(process.cwd(), "lib/campaigns/purchase-destination.ts"), "utf8");
    expect(src).not.toMatch(/billing|trial|quota|supabase|fetch\(/i);
  });
  it("tenant scoping is kept on the queries that read/write ai_proposal", () => {
    for (const f of ["features/promote/actions.ts", "features/campaigns/actions.ts"]) {
      const src = readFileSync(path.join(process.cwd(), f), "utf8");
      expect(src).toMatch(/\.eq\("tenant_id", session\.tenantId\)/);
    }
    const reg = readFileSync(path.join(process.cwd(), "features/campaigns/actions.ts"), "utf8");
    expect(reg).toMatch(/update\(\{ ai_proposal: proposal as unknown as Json[^)]*\)\s*\.eq\("id", campaignId\)\s*\.eq\("tenant_id", session\.tenantId\)/);
  });
});
