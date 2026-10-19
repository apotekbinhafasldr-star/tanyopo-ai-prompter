import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Winning Ads Phase 2B — structural guards. They pin the Founder's separation
 * requirements in the source text itself, so a future edit that wires manual
 * (UNVERIFIED, user-typed) numbers into Budget Guard, Optimization, the launch
 * path or the approval flow fails CI.
 */
const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf-8");

/** Strips comments so assertions check executable code, not prose explaining it. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(path.join(root, dir))) {
    if (name === "node_modules" || name === ".next") continue;
    const rel = path.join(dir, name);
    const st = statSync(path.join(root, rel));
    if (st.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

const NEW_FILES = [
  "features/campaigns/manual-metrics-actions.ts",
  "features/campaigns/manual-metrics-form.tsx",
  "features/campaigns/manual-metrics-row-actions.tsx",
  "features/campaigns/manual-metrics-section.tsx",
  "lib/manual-ad-metrics.ts",
  "schemas/manual-ad-metrics.ts",
];

describe("manual ad metrics — table isolation", () => {
  it("only the Phase 2B files (and the generated types) reference prompter_manual_ad_metrics", () => {
    const allowed = new Set([
      "features/campaigns/manual-metrics-actions.ts",
      "features/campaigns/manual-metrics-section.tsx",
      "lib/manual-ad-metrics.ts",
      "types/database.ts",
    ]);
    const offenders = ["app", "features", "lib", "services", "schemas", "components", "types"]
      .flatMap((d) => walk(d))
      .filter((f) => code(read(f)).includes("prompter_manual_ad_metrics") && !allowed.has(f));
    expect(offenders).toEqual([]);
  });

  it.each([
    "services/budget-guard.ts",
    "features/campaigns/launch-actions.ts",
    "features/campaigns/optimization-actions.ts",
    "features/campaigns/sync-insights-actions.ts",
    "features/campaigns/actions.ts",
    "features/analytics/actions.ts",
    "services/channel-performance.ts",
    "services/channel-campaigns.ts",
    "app/(app)/analytics/page.tsx",
    "app/(app)/products/[id]/page.tsx",
  ])("%s does not read manual metrics (Budget Guard, Optimization, Analytics, launch stay on connector data)", (file) => {
    expect(code(read(file))).not.toContain("prompter_manual_ad_metrics");
  });

  it("the connector sync is still the only writer of prompter_marketing_metrics", () => {
    const writers = ["app", "features", "lib", "services"]
      .flatMap((d) => walk(d))
      .filter((f) => /from\(\s*"prompter_marketing_metrics"\s*\)\s*\.(upsert|insert|update|delete)\(/.test(read(f).replace(/\s+/g, " ").replace(/\) \./g, ").")))
      .sort();
    expect(writers).toEqual(["features/campaigns/sync-insights-actions.ts"]);
  });
});

describe("manual ad metrics — no launch, approval, connector or budget capability", () => {
  const FORBIDDEN_IMPORTS = [
    "launch-actions",
    "@/lib/connectors",
    "@/services/budget-guard",
    "@/services/channel-campaigns",
    "@/features/approvals",
    "@/lib/supabase/admin",
    "token-cipher",
    "oauth",
    "optimization-actions",
    "sync-insights-actions",
    "@/lib/ai",
  ];

  it.each(NEW_FILES)("%s imports none of the launch / approval / connector / budget / admin modules", (file) => {
    const imports = code(read(file))
      .split("\n")
      .filter((l) => /^\s*(import|export)\b.*\bfrom\b/.test(l) || /^\s*import\s+["']/.test(l));
    for (const bad of FORBIDDEN_IMPORTS) {
      expect(imports.filter((l) => l.includes(bad)), `${file} imports ${bad}`).toEqual([]);
    }
  });

  it.each(NEW_FILES)("%s never touches connector metrics, approvals, status, budget or the network", (file) => {
    const src = code(read(file));
    expect(src).not.toMatch(/prompter_marketing_metrics/);
    expect(src).not.toMatch(/prompter_approvals/);
    expect(src).not.toMatch(/prompter_oauth_credentials|prompter_connected_accounts/);
    expect(src).not.toMatch(/BUDGET_WRITE_ENABLED_PLATFORMS|verified:\s*(true|false)/);
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).not.toMatch(/\.rpc\(/);
    expect(src).not.toMatch(/emergency/i);
  });

  it("the actions write only the manual table (audit is a database trigger), never upsert, never update campaign status", () => {
    const src = code(read("features/campaigns/manual-metrics-actions.ts"));
    const tables = [...src.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
    expect(new Set(tables)).toEqual(
      new Set(["prompter_channel_campaigns", "prompter_manual_ad_metrics", "prompter_master_campaigns"]),
    );
    expect(src).not.toMatch(/\.upsert\(/);
    // prompter_channel_campaigns and prompter_master_campaigns are read-only here
    const compact = src.replace(/\s+/g, " ");
    expect(compact).not.toMatch(/from\("prompter_(channel|master)_campaigns"\)\s*\.(insert|update|delete|upsert)/);
  });

  it("the section component never writes at all", () => {
    const src = code(read("features/campaigns/manual-metrics-section.tsx"));
    expect(src).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });

  it("the verdict is advisory: the aggregation module has no side-effect imports", () => {
    const imports = code(read("lib/manual-ad-metrics.ts"))
      .split("\n")
      .filter((l) => /from\s+"/.test(l));
    expect(imports.map((l) => l.match(/from\s+"([^"]+)"/)?.[1])).toEqual(["@/lib/ad-performance-verdict"]);
  });
});

describe("manual ad metrics — page wiring", () => {
  const page = read("app/(app)/campaigns/[id]/page.tsx");
  it("mounts the section once, without touching the launch controls", () => {
    expect(page.match(/<ManualMetricsSection/g)).toHaveLength(1);
    expect(page).toContain("canOfferLaunch(campaign.status, cc.channel, cc.status)");
  });
  it("the Phase 2A engine file is imported, not forked", () => {
    expect(read("lib/manual-ad-metrics.ts")).toContain('from "@/lib/ad-performance-verdict"');
  });
});
