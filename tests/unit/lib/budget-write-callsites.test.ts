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

/** Number of top-level arguments of every call `name(...)` in `text`. */
function argumentCounts(text: string, name: string): number[] {
  const counts: number[] = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(`${name}(`, from);
    if (at === -1) return counts;
    let depth = 0;
    let args = 0;
    let sawContent = false;
    let i = at + name.length;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (ch === "(" || ch === "[" || ch === "{") {
        depth++;
        if (depth > 1) sawContent = true;
      } else if (ch === ")" || ch === "]" || ch === "}") {
        depth--;
        if (depth === 0) break;
      } else if (ch === "," && depth === 1) {
        if (sawContent) args++;
        sawContent = false;
      } else if (depth >= 1 && !/\s/.test(ch)) {
        sawContent = true;
      }
    }
    if (sawContent) args++;
    counts.push(args);
    from = i;
  }
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

  it("no production code can inject a platform list into the gate (no bypass seam)", () => {
    const GUARD = "lib/campaigns/external-budget-guard.ts";
    const CORE = "lib/campaigns/external-budget-guard-core.ts";
    for (const { file, text } of sources) {
      if (file === GUARD || file === CORE) continue;
      expect(text, file).not.toMatch(/BUDGET_WRITE_ENABLED_PLATFORMS/);
      expect(text, file).not.toMatch(/external-budget-guard-core/);
      expect(text, file).not.toMatch(/evaluateWithPlatforms/);
      // Any second argument (literal, variable or expression) is a seam.
      for (const name of ["evaluateExternalBudgetWrite", "isBudgetWritePlatformEnabled"]) {
        for (const count of argumentCounts(text, name)) expect(count, `${file}: ${name}`).toBe(1);
      }
    }
  });

  it("only the public gate module imports the internal core", () => {
    const importers = sources.filter(({ text }) => /external-budget-guard-core/.test(text)).map(({ file }) => file);
    expect(importers).toEqual(["lib/campaigns/external-budget-guard.ts"]);
  });

  it("call sites call the gate with exactly one argument", () => {
    for (const file of ["features/campaigns/launch-actions.ts", "features/approvals/actions.ts"]) {
      const text = sources.find((s) => s.file === file)!.text;
      const counts = argumentCounts(text, "evaluateExternalBudgetWrite");
      expect(counts.length, file).toBeGreaterThan(0);
      expect(counts.every((c) => c === 1), file).toBe(true);
    }
  });

  it("argumentCounts detects a second argument (self-check of the scanner)", () => {
    const g = "evaluateExternalBudgetWrite";
    expect(argumentCounts(`${g}({ a: 1, b: [1, 2] })`, g)).toEqual([1]);
    expect(argumentCounts(`${g}({ a: 1 }, list)`, g)).toEqual([2]);
    expect(argumentCounts(`${g}(req, ["META"])`, g)).toEqual([2]);
    expect(argumentCounts(`${g}(req,\n)`, g)).toEqual([1]);
    expect(argumentCounts("isBudgetWritePlatformEnabled(p, fn(a, b))", "isBudgetWritePlatformEnabled")).toEqual([2]);
  });
});
