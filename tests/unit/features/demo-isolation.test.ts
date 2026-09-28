import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * LINOE Demo Environment Phase 1 — structural isolation checks. These
 * pin source text, not runtime behavior, but they prove something the
 * design report relies on: the demo code path has no way to reach a real
 * tenant, RLS-scoped table, or ad-platform/billing integration, because
 * it never imports the modules that do.
 */
const demoDir = path.resolve(__dirname, "../../../features/demo");
const demoFiles = readdirSync(demoDir)
  .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
  .map((f) => ({ name: f, source: readFileSync(path.join(demoDir, f), "utf-8") }));

describe("features/demo/* — never reaches real tenant identity", () => {
  it("never imports services/session (requireSessionContext) — a demo session is never a real tenant session", () => {
    for (const file of demoFiles) {
      expect(file.source, `${file.name} must not import services/session`).not.toMatch(
        /from ["']@\/services\/session["']/,
      );
    }
  });

  it("never imports the user's own Supabase server client (@/lib/supabase/server) — no RLS-scoped query is possible from demo code", () => {
    for (const file of demoFiles) {
      expect(file.source, `${file.name} must not import lib/supabase/server`).not.toMatch(
        /from ["']@\/lib\/supabase\/server["']/,
      );
    }
  });
});

describe("features/demo/campaign-actions.ts — advertising safety (Founder hard requirement #4)", () => {
  const source = readFileSync(path.join(demoDir, "campaign-actions.ts"), "utf-8");

  it("never imports a real ad-platform connector or OAuth/credential module", () => {
    expect(source).not.toMatch(/from ["']@\/lib\/connectors/);
    expect(source).not.toMatch(/decryptToken/);
    expect(source).not.toMatch(/getConnector/);
  });

  it("never references the real campaign-launch action it mirrors", () => {
    expect(source).not.toMatch(/launchChannelCampaignAction/);
  });

  it("never touches prompter_channel_campaigns or prompter_connected_accounts", () => {
    expect(source).not.toMatch(/prompter_channel_campaigns/);
    expect(source).not.toMatch(/prompter_connected_accounts/);
  });
});

describe("features/demo/* — billing safety (Founder hard requirement #5)", () => {
  it("no demo file references real billing/checkout/subscription modules", () => {
    for (const file of demoFiles) {
      expect(file.source, `${file.name} must not import services/checkout or services/billing`).not.toMatch(
        /from ["']@\/services\/(checkout|billing)["']/,
      );
    }
  });
});

describe("features/demo/ai-actions.ts — AI cost ceiling (Founder hard requirement #3)", () => {
  const source = readFileSync(path.join(demoDir, "ai-actions.ts"), "utf-8");

  it("never calls the tenant-scoped runAiJob chokepoint (would consume/require a real tenant's AI allowance)", () => {
    expect(source).not.toMatch(/runAiJob/);
  });

  it("checks the demo AI usage cap before every live AI call", () => {
    const liveCallCount = (source.match(/routeStructuredGeneration/g) ?? []).length;
    const capCheckCount = (source.match(/checkAndConsumeDemoAiUsage/g) ?? []).length;
    expect(capCheckCount).toBeGreaterThanOrEqual(liveCallCount);
  });
});
