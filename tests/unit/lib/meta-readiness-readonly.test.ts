import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Architecture guard for Phase F-2a: the Meta readiness check must stay
 * READ-ONLY. These are source-level assertions (same style as
 * budget-write-callsites.test.ts): they fail if someone later adds a write, a
 * budget call, a Budget Gate import or a log of sensitive data to this path.
 */

const ROOT = process.cwd();
function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

/** The text of the connector method, from its doc-comment-free signature to the next method. */
function connectorReadinessMethod(): string {
  const source = read("lib/connectors/meta-connector.ts");
  const start = source.indexOf("async getAccountReadinessSnapshot(");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("async createCampaign(", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

/**
 * The F-2a server action, from its declaration to where the F-2b selection
 * code begins (that part legitimately writes the stored choice; it has its own
 * guard in meta-ad-account-selection-guard.test.ts).
 */
function readinessAction(): string {
  const source = read("features/connections/actions.ts");
  const start = source.indexOf("export async function checkMetaAdAccountReadinessAction");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("const PRE_LAUNCH_STATUSES", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

const WRITE_PATTERNS: Array<[string, RegExp]> = [
  ["a database insert", /\.insert\(/],
  ["a database update", /\.update\(/],
  ["a database upsert", /\.upsert\(/],
  ["a database delete", /\.delete\(/],
  ["an rpc call", /\.rpc\(/],
  ["a POST request", /method:\s*["']POST["']/],
  ["a DELETE request", /method:\s*["']DELETE["']/],
];

describe("Meta readiness check stays read-only", () => {
  const files: Array<[string, () => string]> = [
    ["lib/connectors/meta-readiness.ts", () => read("lib/connectors/meta-readiness.ts")],
    ["features/connections/meta-readiness-core.ts", () => read("features/connections/meta-readiness-core.ts")],
    ["features/connections/meta-readiness-view.tsx", () => read("features/connections/meta-readiness-view.tsx")],
    ["features/connections/meta-readiness-panel.tsx", () => read("features/connections/meta-readiness-panel.tsx")],
    ["MetaConnector#getAccountReadinessSnapshot", connectorReadinessMethod],
    ["checkMetaAdAccountReadinessAction", readinessAction],
  ];

  for (const [name, getText] of files) {
    it(`${name} performs no write`, () => {
      const text = getText();
      for (const [label, pattern] of WRITE_PATTERNS) {
        expect(pattern.test(text), `${name} must not contain ${label}`).toBe(false);
      }
    });
  }

  it("never touches the External Budget Safety Gate, budgets or campaign creation", () => {
    for (const [name, getText] of files) {
      const text = getText();
      expect(text, name).not.toContain("external-budget-guard");
      expect(text, name).not.toContain("BUDGET_WRITE_ENABLED_PLATFORMS");
      expect(text, name).not.toMatch(/\.(createCampaign|createAdSet|createCreative|createAd|updateBudget|pauseCampaign)\(/);
    }
  });

  it("never requests funding_source_details (payment-method details)", () => {
    expect(connectorReadinessMethod()).not.toContain("funding_source_details");
  });

  it("logs only through the allowlisted summary, never a message, token or response body", () => {
    const action = readinessAction();
    expect(action).toContain("describeSafeError");
    expect(action).not.toMatch(/console\.(log|error|warn)\([^)]*(accessToken|token|\.message|encrypted)/);
    const core = read("features/connections/meta-readiness-core.ts");
    expect(core).not.toMatch(/console\./);
  });

  it("the client panel does not import any server-only module directly", () => {
    const panel = read("features/connections/meta-readiness-panel.tsx");
    expect(panel).not.toContain("server-only");
    expect(panel).not.toContain("@/lib/supabase");
    expect(panel).not.toContain("token-cipher");
    expect(panel).not.toContain("meta-connector");
  });
});
