import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LAUNCH_IN_PROGRESS_NOTE } from "@/lib/campaigns/launch-reconciliation";
import { ALL_STATUSES, IN_PROGRESS_NOTE, stmt } from "../../integration/pg/fixture";

/**
 * Keeps the SQL used by the PostgreSQL concurrency tests honest: it must stay
 * the equivalent of what the application really sends, and the fixture schema
 * must stay the equivalent of the migrations. Runs in the normal unit job.
 */
const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const squash = (s: string) => s.replace(/\s+/g, " ");

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`async function ${name}(`);
  expect(start, `${name} not found in launch-actions.ts`).toBeGreaterThan(-1);
  const rest = source.slice(start + 1);
  const next = rest.search(/\nasync function |\nfunction |\nexport async function /);
  return squash(source.slice(start, next < 0 ? undefined : start + 1 + next));
}

describe("PG test SQL mirrors the application", () => {
  const launch = read("features/campaigns/launch-actions.ts");

  it("uses the application's in-progress note", () => {
    expect(IN_PROGRESS_NOTE).toBe(LAUNCH_IN_PROGRESS_NOTE);
  });

  it("claim: status SCHEDULED -> FAILED(+note), filtered by id, tenant and status, exactly one row", () => {
    const body = functionBody(launch, "claimChannelCampaignLaunch");
    expect(body).toContain('.update({ status: "FAILED", error: LAUNCH_IN_PROGRESS_NOTE })');
    expect(body).toContain('.eq("id", channelCampaignId)');
    expect(body).toContain('.eq("tenant_id", tenantId)');
    expect(body).toContain('.eq("status", "SCHEDULED")');
    expect(body).toContain("data.length !== 1");

    const sql = squash(stmt.claim("i", "t"));
    expect(sql).toContain("set status = 'FAILED'");
    expect(sql).toContain("where id = 'i' and tenant_id = 't' and status = 'SCHEDULED'");
  });

  it("progress and final writes: only while the row is still FAILED, by id and tenant, exactly one row", () => {
    const body = functionBody(launch, "persistLaunchProgress");
    expect(body).toContain('.eq("id", channelCampaignId)');
    expect(body).toContain('.eq("tenant_id", tenantId)');
    expect(body).toContain('.eq("status", "FAILED")');
    expect(body).toContain("data.length !== 1");
    expect(squash(stmt.progress("i", "t", { error: "e" }))).toContain("where id = 'i' and tenant_id = 't' and status = 'FAILED'");
  });

  it("failure write: only while FAILED; releasable branch returns to SCHEDULED with a cleared id", () => {
    const body = functionBody(launch, "recordLaunchFailure");
    expect(body).toContain('{ status: "SCHEDULED" as const, error: null, external_campaign_id: null }');
    expect(body).toContain('.eq("status", "FAILED")');
    expect(squash(stmt.release("i", "t"))).toContain("set status = 'SCHEDULED', error = null, external_campaign_id = null");
    expect(squash(stmt.release("i", "t"))).toContain("and status = 'FAILED'");
    expect(squash(stmt.fail("i", "t", "m", null))).toContain("and status = 'FAILED'");
  });

  it("the final ACTIVE write goes through the guarded progress helper", () => {
    expect(squash(launch)).toContain(
      'await persistLaunchProgress(supabase, session.tenantId, channelCampaignId, { status: "ACTIVE", error: null, });',
    );
  });
});

describe("PG fixture schema mirrors the migrations", () => {
  const schema = read("tests/integration/pg/schema.sql");
  const migration = read("supabase/migrations/20260829095447_prompter_phase2_schema.sql");

  it("has the same status values", () => {
    const fromMigration = /status in \(([^)]*)\)/.exec(migration)?.[1] ?? "";
    const fromFixture = /status in \(([^)]*)\)/.exec(schema)?.[1] ?? "";
    const names = (s: string) => [...s.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
    expect(names(fromFixture)).toEqual(names(fromMigration));
    expect(names(fromFixture)).toEqual([...ALL_STATUSES].sort());
  });

  it("has the same channels, unique constraint and RLS policies", () => {
    const channels = (s: string) => [...(/channel in \(([^)]*)\)/.exec(s)?.[1] ?? "").matchAll(/'([A-Z]+)'/g)].map((m) => m[1]).sort();
    expect(channels(schema)).toEqual(channels(migration));
    for (const text of [
      "unique (master_campaign_id, channel)",
      'create policy "Lihat channel campaign tenant sendiri"',
      'create policy "Owner/marketing kelola channel campaign"',
      "fn_current_role() in ('owner', 'marketing')",
      "enable row level security",
    ]) {
      expect(schema).toContain(text);
      expect(migration.replace(/public\./g, "")).toContain(text);
    }
  });

  it("never references Supabase or production-only tables as dependencies", () => {
    const code = schema.replace(/^\s*--.*$/gm, "");
    expect(code).not.toMatch(/references\s/i);
    expect(code).not.toMatch(/supabase/i);
  });
});
