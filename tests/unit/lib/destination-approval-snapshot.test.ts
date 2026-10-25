import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
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
const prop = (d?: unknown) => (d === undefined ? { headline: "x" } : { headline: "x", purchase_destination: d });
const ctx = (p: unknown) => ({ [DESTINATION_SNAPSHOT_KEY]: buildDestinationSnapshot(p, OWN) });

describe("buildDestinationSnapshot", () => {
  it("legacy / none / valid / invalid", () => {
    expect(buildDestinationSnapshot(prop(), OWN)).toEqual({ version: 1, kind: "legacy" });
    expect(buildDestinationSnapshot(prop({ version: 1, type: "NONE", value: null, link: null }), OWN).kind).toBe("none");
    expect(buildDestinationSnapshot(prop(WEB), OWN)).toMatchObject({ kind: "destination", type: "WEBSITE", link: WEB.link });
    expect(buildDestinationSnapshot(prop({ ...WEB, value: "http://x.com", link: "http://x.com" }), OWN).kind).toBe("invalid");
  });
  it("not tied to ownHosts presence for a valid seller URL", () => {
    expect(buildDestinationSnapshot(prop(WEB), null).kind).toBe("destination");
  });
});

describe("checkApprovalDestinationSnapshot", () => {
  it("same destination passes", () => {
    expect(checkApprovalDestinationSnapshot(ctx(prop(WEB)), prop(WEB), OWN).ok).toBe(true);
    expect(checkApprovalDestinationSnapshot(ctx(prop(WA)), prop(WA), OWN).ok).toBe(true);
  });
  it("changed type or value is rejected", () => {
    expect(checkApprovalDestinationSnapshot(ctx(prop(WEB)), prop(WA), OWN).ok).toBe(false);
    const other = { ...WEB, value: "https://lain.com/", link: "https://lain.com/" };
    expect(checkApprovalDestinationSnapshot(ctx(prop(WEB)), prop(other), OWN).ok).toBe(false);
  });
  it("changed to NONE or destination removed after approval is rejected", () => {
    expect(checkApprovalDestinationSnapshot(ctx(prop(WEB)), prop({ version: 1, type: "NONE", value: null, link: null }), OWN).ok).toBe(false);
    expect(checkApprovalDestinationSnapshot(ctx(prop(WEB)), prop(), OWN).ok).toBe(false);
  });
  it("snapshot of legacy only matches a still-legacy campaign", () => {
    expect(checkApprovalDestinationSnapshot(ctx(prop()), prop(), OWN).ok).toBe(true);
    expect(checkApprovalDestinationSnapshot(ctx(prop()), prop(WEB), OWN).ok).toBe(false);
  });
  it("no snapshot: legacy campaign ok, new-format campaign fails closed", () => {
    expect(checkApprovalDestinationSnapshot({ daily_budget: 1 }, prop(), OWN).ok).toBe(true);
    expect(checkApprovalDestinationSnapshot(null, prop(), OWN).ok).toBe(true);
    expect(checkApprovalDestinationSnapshot({ daily_budget: 1 }, prop(WEB), OWN).ok).toBe(false);
    expect(checkApprovalDestinationSnapshot(undefined, prop(WA), OWN).ok).toBe(false);
  });
  it.each([
    "oops",
    42,
    [],
    { kind: "none" },
    { kind: "invalid" },
    { kind: "destination" },
    { kind: "destination", type: "WEBSITE", value: WEB.value, link: "https://beda.com/" },
  ])("malformed snapshot %j fails closed", (bad) => {
    expect(checkApprovalDestinationSnapshot({ [DESTINATION_SNAPSHOT_KEY]: bad }, prop(WEB), OWN).ok).toBe(false);
  });
  it("a tampered current destination that is now invalid is rejected", () => {
    const tampered = { ...WEB, link: "http://evil.com" };
    expect(checkApprovalDestinationSnapshot(ctx(prop(WEB)), prop(tampered), OWN).ok).toBe(false);
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

describe("regenerate keeps the destination (source regression)", () => {
  const src = readFileSync(path.join(process.cwd(), "features/campaigns/actions.ts"), "utf8");
  const start = src.indexOf("export async function regenerateCampaignProposalAction");
  const body = src.slice(start, src.indexOf("export async function", start + 10));
  it("reads the existing destination and writes it back onto the new proposal", () => {
    expect(body).toContain("PURCHASE_DESTINATION_KEY");
    expect(body).toContain('.eq("tenant_id"');
  });
});
