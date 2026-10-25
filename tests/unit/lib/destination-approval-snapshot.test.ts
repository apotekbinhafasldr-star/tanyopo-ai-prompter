import { describe, expect, it } from "vitest";
import {
  buildDestinationSnapshot,
  checkApprovalDestinationSnapshot,
  summarizeDestinationInput,
  DESTINATION_SNAPSHOT_KEY,
} from "@/lib/campaigns/purchase-destination";
import { BUDGET_WRITE_ENABLED_PLATFORMS } from "@/lib/campaigns/external-budget-guard";

const OWN = ["linoe.example.com"];
const WEB = { version: 1, type: "WEBSITE", value: "https://tokosaya.com/a", link: "https://tokosaya.com/a" };
const WA = { version: 1, type: "WHATSAPP", value: "081234567890", link: "https://wa.me/6281234567890" };
const NONE = { version: 1, type: "NONE", value: null, link: null };
const prop = (d?: unknown) => (d === undefined ? { headline: "x" } : { headline: "x", purchase_destination: d });
const URL1 = "https://toko-saya.co.id/produk";
const ctx = (p: unknown, legacyUrl: string | null = URL1) => ({
  [DESTINATION_SNAPSHOT_KEY]: buildDestinationSnapshot(p, OWN, legacyUrl),
});

describe("buildDestinationSnapshot", () => {
  it("legacy campaigns record the ACTUAL landing URL, or 'legacy_unresolved' when there is none", () => {
    expect(buildDestinationSnapshot(prop(), OWN, URL1)).toEqual({ version: 1, kind: "legacy_url", link: URL1 });
    expect(buildDestinationSnapshot(prop(), OWN, null)).toEqual({ version: 1, kind: "legacy_unresolved" });
    expect(JSON.stringify(buildDestinationSnapshot(prop(), OWN, URL1))).not.toBe('{"version":1,"kind":"legacy"}');
  });
  it("none / valid / invalid stored destinations", () => {
    expect(buildDestinationSnapshot(prop(NONE), OWN, null).kind).toBe("none");
    expect(buildDestinationSnapshot(prop(WEB), OWN, URL1)).toMatchObject({ kind: "destination", type: "WEBSITE", link: WEB.link });
    expect(buildDestinationSnapshot(prop({ ...WEB, value: "http://x.com", link: "http://x.com" }), OWN, null).kind).toBe("invalid");
  });
  it("the legacy URL is ignored when the campaign has its own destination", () => {
    expect(JSON.stringify(buildDestinationSnapshot(prop(WEB), OWN, URL1))).not.toContain("toko-saya");
  });
});

describe("checkApprovalDestinationSnapshot — stored destination", () => {
  it("same destination passes", () => {
    expect(checkApprovalDestinationSnapshot(ctx(prop(WEB)), prop(WEB), OWN).ok).toBe(true);
    expect(checkApprovalDestinationSnapshot(ctx(prop(WA)), prop(WA), OWN).ok).toBe(true);
  });
  it("changed type or value is rejected", () => {
    expect(checkApprovalDestinationSnapshot(ctx(prop(WEB)), prop(WA), OWN).ok).toBe(false);
    const other = { ...WEB, value: "https://lain.com/", link: "https://lain.com/" };
    expect(checkApprovalDestinationSnapshot(ctx(prop(WEB)), prop(other), OWN).ok).toBe(false);
  });
  it("changed to NONE, or destination removed after approval, is rejected", () => {
    expect(checkApprovalDestinationSnapshot(ctx(prop(WEB)), prop(NONE), OWN).ok).toBe(false);
    expect(checkApprovalDestinationSnapshot(ctx(prop(WEB)), prop(), OWN, URL1).ok).toBe(false);
  });
  it("none stays none (nothing to compare; launch refuses it on its own)", () => {
    expect(checkApprovalDestinationSnapshot(ctx(prop(NONE), null), prop(NONE), OWN).ok).toBe(true);
  });
  it.each([
    "oops",
    42,
    [],
    { kind: "none" },
    { kind: "invalid" },
    { kind: "destination" },
    { kind: "legacy" },
    { kind: "destination", type: "WEBSITE", value: WEB.value, link: "https://beda.com/" },
  ])("malformed snapshot %j fails closed", (bad) => {
    expect(checkApprovalDestinationSnapshot({ [DESTINATION_SNAPSHOT_KEY]: bad }, prop(WEB), OWN).ok).toBe(false);
  });
  it("a forged link alone changes nothing (rebuilt from value); a forged value does", () => {
    const forgedLink = { ...WEB, link: "http://evil.com" };
    expect(checkApprovalDestinationSnapshot(ctx(prop(WEB)), prop(forgedLink), OWN).ok).toBe(true);
    const forgedValue = { ...WEB, value: "http://evil.com", link: "http://evil.com" };
    expect(checkApprovalDestinationSnapshot(ctx(prop(WEB)), prop(forgedValue), OWN).ok).toBe(false);
  });
});

describe("checkApprovalDestinationSnapshot — legacy campaigns and old approvals", () => {
  it("same landing URL passes", () => {
    expect(checkApprovalDestinationSnapshot(ctx(prop()), prop(), OWN, URL1).ok).toBe(true);
  });
  it("landing URL changed, removed (null) or unknown (undefined) is rejected", () => {
    expect(checkApprovalDestinationSnapshot(ctx(prop()), prop(), OWN, "https://toko-lain.co.id/").ok).toBe(false);
    expect(checkApprovalDestinationSnapshot(ctx(prop()), prop(), OWN, null).ok).toBe(false);
    expect(checkApprovalDestinationSnapshot(ctx(prop()), prop(), OWN, undefined).ok).toBe(false);
  });
  it("'legacy_unresolved' only matches a campaign that is still unresolved", () => {
    const c = ctx(prop(), null);
    expect(checkApprovalDestinationSnapshot(c, prop(), OWN, null).ok).toBe(true);
    expect(checkApprovalDestinationSnapshot(c, prop(), OWN, URL1).ok).toBe(false);
    expect(checkApprovalDestinationSnapshot(c, prop(), OWN, undefined).ok).toBe(false);
  });
  it("a legacy snapshot does not cover a campaign that now has its own destination", () => {
    expect(checkApprovalDestinationSnapshot(ctx(prop()), prop(WEB), OWN, URL1).ok).toBe(false);
  });
  it("NO approval without a snapshot is ever trusted — not for legacy, not for new-format", () => {
    for (const old of [{ daily_budget: 1 }, {}, null, undefined, "x"]) {
      expect(checkApprovalDestinationSnapshot(old, prop(), OWN, URL1).ok).toBe(false);
      expect(checkApprovalDestinationSnapshot(old, prop(WEB), OWN).ok).toBe(false);
    }
  });
  it("the refusal tells the user how to recover", () => {
    const r = checkApprovalDestinationSnapshot(null, prop(), OWN, URL1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Kembalikan ke Draft/);
  });
});

describe("summarizeDestinationInput", () => {
  it("summarises valid input and hides invalid", () => {
    expect(summarizeDestinationInput("WEBSITE", "https://tokosaya.com/a")).toContain("tokosaya.com");
    expect(summarizeDestinationInput("WHATSAPP", "081234567890")).toContain("WhatsApp");
    expect(summarizeDestinationInput("NONE", "")).toMatch(/Belum ada tujuan/);
    expect(summarizeDestinationInput("WEBSITE", "http://x.com")).toBeNull();
    expect(summarizeDestinationInput("", "")).toBeNull();
  });
  it("forbidden LINOE hosts are rejected", () => {
    expect(summarizeDestinationInput("WEBSITE", "https://tanyopo-ai-prompter.netlify.app/x")).toBeNull();
    expect(summarizeDestinationInput("WEBSITE", "https://tanyopo.ai/")).toBeNull();
  });
});

describe("paid-ad gate stays default-deny", () => {
  it("BUDGET_WRITE_ENABLED_PLATFORMS is empty", () => {
    expect(BUDGET_WRITE_ENABLED_PLATFORMS).toEqual([]);
  });
});
