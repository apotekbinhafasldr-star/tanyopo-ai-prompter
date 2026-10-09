import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Architecture guard for the External Budget Safety Gate: the connector
 * methods that write a budget externally (createCampaign, createAdSet,
 * updateBudget) may only be called from the two known entry points, and each
 * must call the gate before the connector. A new caller fails this test.
 */

const ROOT = process.cwd();
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "tests", "docs", "public", "supabase", ".netlify"]);
const CONNECTOR_CALL = /\.(createCampaign|createAdSet|updateBudget)\(/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

function rel(file: string) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

const sources = walk(ROOT)
  .map((file) => ({ file: rel(file), text: readFileSync(file, "utf8") }))
  // The connector implementations and their interface define these methods.
  .filter(({ file }) => !/^lib\/connectors\/(.+-connector|types)\.ts$/.test(file));

const callers = sources.filter(({ text }) => CONNECTOR_CALL.test(text));

describe("external budget write call sites", () => {
  it("only the launch action and the autopilot executor call the connector budget methods", () => {
    expect(callers.map(({ file }) => file).sort()).toEqual([
      "features/approvals/actions.ts",
      "features/campaigns/launch-actions.ts",
    ]);
  });

  it.each(["features/campaigns/launch-actions.ts", "features/approvals/actions.ts"])(
    "%s calls the gate before any connector budget call",
    (file) => {
      const text = sources.find((s) => s.file === file)!.text;
      const gateIndex = text.indexOf("evaluateExternalBudgetWrite(");
      const connectorIndex = text.search(CONNECTOR_CALL);
      expect(gateIndex).toBeGreaterThan(-1);
      expect(gateIndex).toBeLessThan(connectorIndex);
    },
  );

  it("the launch action also applies the static platform lock before the claim", () => {
    const text = sources.find((s) => s.file === "features/campaigns/launch-actions.ts")!.text;
    const lock = text.indexOf("isBudgetWritePlatformEnabled(");
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(text.indexOf(".update({ error: null })"));
  });

  it("the launch gate runs before the atomic claim", () => {
    const text = sources.find((s) => s.file === "features/campaigns/launch-actions.ts")!.text;
    expect(text.indexOf("evaluateExternalBudgetWrite(")).toBeLessThan(text.indexOf(".update({ error: null })"));
  });

  it("the autopilot gate runs before the connected account and credentials are read", () => {
    const text = sources.find((s) => s.file === "features/approvals/actions.ts")!.text;
    const gate = text.indexOf("evaluateExternalBudgetWrite(");
    expect(gate).toBeLessThan(text.indexOf('.from("prompter_connected_accounts")'));
    expect(gate).toBeLessThan(text.indexOf('.from("prompter_oauth_credentials")'));
  });

  it("no production code passes its own platform list to the gate (no bypass seam)", () => {
    for (const { file, text } of sources) {
      if (file === "lib/campaigns/external-budget-guard.ts") continue;
      expect(text, file).not.toMatch(/BUDGET_WRITE_ENABLED_PLATFORMS/);
      expect(text, file).not.toMatch(/evaluateExternalBudgetWrite\([^)]*,\s*\[/);
    }
  });
});
