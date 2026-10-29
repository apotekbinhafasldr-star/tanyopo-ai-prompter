import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { BUDGET_WRITE_ENABLED_PLATFORMS } from "@/lib/campaigns/external-budget-guard";
import { META_CURRENCY_BUDGET_UNITS } from "@/lib/campaigns/meta-budget-units";
import { META_OBJECTIVE_CONTRACTS } from "@/lib/campaigns/meta-objective-contracts";

const launch = readFileSync("features/campaigns/launch-actions.ts", "utf8");

/** Index of the first occurrence of each marker; fails loudly if one is missing. */
function at(marker: string | RegExp, from = 0): number {
  const index = typeof marker === "string" ? launch.indexOf(marker, from) : launch.slice(from).search(marker);
  expect(index, String(marker)).toBeGreaterThan(-1);
  return typeof marker === "string" ? index : index + from;
}

describe("Phase 1C-B — the Meta launch happens in the required order", () => {
  it("platform lock -> Emergency Stop -> Owner approval -> account confirmation -> credentials -> currency -> gate -> validator -> preflight -> claim -> connector", () => {
    const lock = at("if (!isBudgetWritePlatformEnabled(connectorPlatform))");
    const emergency = at("await readEmergencyStopStrict(supabase, session.tenantId)");
    const approval = at('.from("prompter_approvals")');
    const confirmation = at("await readSelectionConfirmed(");
    const expiry = at("connectedAccount.expires_at");
    const credentials = at('.from("prompter_oauth_credentials")');
    const decrypt = at("decryptToken(credentials");
    const currency = at("await readMetaAccountCurrency(connector");
    const gate = launch.lastIndexOf("evaluateExternalBudgetWrite({");
    const validator = at("resolveMetaLaunchBudget({");
    const preflight = at("await runMetaPreflight({");
    const claim = at("claimChannelCampaignLaunch(supabase");
    const connectorCall = at(/connector\.createCampaign\(/);

    const order = [lock, emergency, approval, confirmation, expiry, credentials, decrypt, currency, gate, validator, preflight, claim, connectorCall];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(new Set(order).size).toBe(order.length);
  });

  it("every refusal in the new steps returns BEFORE the claim (no state is written by them)", () => {
    const claim = at("claimChannelCampaignLaunch(supabase");
    for (const marker of [
      "ACCOUNT_UNCONFIRMED_MESSAGE }",
      "ACCOUNT_CONFIRMATION_UNREADABLE_MESSAGE }",
      "TOKEN_EXPIRED_MESSAGE }",
      "currencyRead.message",
      "metaBudget.message",
    ]) {
      expect(at(marker), marker).toBeLessThan(claim);
    }
  });

  it("the Budget Gate receives the SAME verified currency as the validator (one variable, no second source)", () => {
    expect(launch).toContain("accountCurrency = currencyRead.currency;");
    expect(launch.slice(launch.lastIndexOf("evaluateExternalBudgetWrite({"))).toContain("    accountCurrency,\n");
    expect(launch.slice(launch.indexOf("resolveMetaLaunchBudget({"))).toContain("      accountCurrency,\n");
    // The only literal null for the currency is the Emergency Stop pre-check (before any evidence exists).
    expect(launch.match(/accountCurrency: null/g)).toHaveLength(1);
    expect(at("accountCurrency: null")).toBeLessThan(at("await readSelectionConfirmed("));
  });

  it("META has no budget fallback: the amount sent is the validator's, never the whole-IDR share", () => {
    expect(launch).not.toContain("?? allocatedDailyBudget");
    expect(launch).not.toMatch(/const dailyBudgetMinorUnits = allocatedDailyBudget;/);
    expect(launch).toContain("const dailyBudgetMinorUnits = launchDailyBudgetMinorUnits;");
    const metaBranch = launch.slice(at("let launchDailyBudgetMinorUnits: number;"), at("// Meta preflight (PR #36)"));
    expect(metaBranch).toContain("launchDailyBudgetMinorUnits = metaBudget.value.minorUnits;");
    expect(metaBranch).toContain("return { error: metaBudget.message };");
    // Only the non-Meta branch may use the share directly.
    expect(metaBranch.match(/launchDailyBudgetMinorUnits = allocatedDailyBudget;/g)).toHaveLength(1);
    expect(metaBranch.indexOf("launchDailyBudgetMinorUnits = allocatedDailyBudget;")).toBeGreaterThan(metaBranch.indexOf("} else {"));
  });

  it("the credentials are read for the session tenant AND the connected account", () => {
    const read = launch.slice(at('.from("prompter_oauth_credentials")'), at("if (!credentials)"));
    expect(read).toContain('.eq("connected_account_id", connectedAccount.id)');
    expect(read).toContain('.eq("tenant_id", session.tenantId)');
  });

  it("the token never reaches a log, a message or the browser from the new code", () => {
    expect(launch).not.toMatch(/console\.[a-z]+\([^)]*accessToken/);
    const helper = launch.slice(at("async function readMetaAccountCurrency("), at("export interface LaunchActionState"));
    expect(helper).not.toMatch(/console\.|catch \(|JSON\.stringify|\.message/);
    for (const name of ["ACCOUNT_UNCONFIRMED_MESSAGE", "TOKEN_EXPIRED_MESSAGE", "CURRENCY_UNVERIFIED_MESSAGE", "ACCOUNT_MISMATCH_MESSAGE"]) {
      const definition = launch.slice(at(`const ${name} =`), at(";", at(`const ${name} =`)));
      expect(definition, name).not.toMatch(/\$\{/);
    }
  });
});

describe("Phase 1C-B — there is ONE confirmation mechanism, and nothing was opened", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (["node_modules", ".next", ".git", "tests", "docs", "public", "supabase", ".netlify"].includes(entry)) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
    return out;
  }
  const sources = walk(process.cwd()).map((file) => ({ file: path.relative(process.cwd(), file).split(path.sep).join("/"), text: readFileSync(file, "utf8") }));

  it("the confirmation marker is defined once, in a module that is NOT a server-action file", () => {
    const definers = sources.filter((s) => s.text.includes('"connection.meta_ad_account_selected"')).map((s) => s.file);
    expect(definers).toEqual(["features/connections/meta-selection-confirmation.ts"]);
    const shared = sources.find((s) => s.file === "features/connections/meta-selection-confirmation.ts")!.text;
    expect(shared).not.toMatch(/^"use server"/m);
    const implementations = sources.filter((s) => /function readSelectionConfirmed\(/.test(s.text)).map((s) => s.file);
    expect(implementations).toEqual(["features/connections/meta-selection-confirmation.ts"]);
  });

  it("the Connections actions and the launch both use that one implementation", () => {
    expect(sources.find((s) => s.file === "features/connections/actions.ts")!.text).toContain(
      'from "@/features/connections/meta-selection-confirmation"',
    );
    expect(launch).toContain('from "@/features/connections/meta-selection-confirmation"');
  });

  it("the Budget Gate allowlist is empty, IDR is unverified, Traffic is unverified", () => {
    expect(BUDGET_WRITE_ENABLED_PLATFORMS).toHaveLength(0);
    expect(META_CURRENCY_BUDGET_UNITS.IDR).toEqual({ minorUnitsPerUnit: null, verified: false });
    expect(META_OBJECTIVE_CONTRACTS.WEBSITE_TRAFFIC.verified).toBe(false);
  });

  it("every Meta object is still created PAUSED and the final status is still PAUSED", () => {
    const connector = readFileSync("lib/connectors/meta-connector.ts", "utf8");
    expect(connector.match(/status: "PAUSED"/g)?.length).toBeGreaterThanOrEqual(4);
    expect(connector).not.toMatch(/status: "ACTIVE"/);
    expect(launch).toContain("statusAfterSuccessfulLaunch(connectorPlatform)");
  });
});
