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

  it("claim: status SCHEDULED -> FAILED(+nonce note), filtered by id, tenant and status, exactly one row", () => {
    const body = functionBody(launch, "claimChannelCampaignLaunch");
    expect(body).toContain('.update({ status: "FAILED", error: claimNote })');
    expect(body).toContain('.eq("id", channelCampaignId)');
    expect(body).toContain('.eq("tenant_id", tenantId)');
    expect(body).toContain('.eq("status", "SCHEDULED")');
    expect(body).toContain("data.length !== 1");

    const sql = squash(stmt.claim("i", "t"));
    expect(sql).toContain("set status = 'FAILED'");
    expect(sql).toContain("where id = 'i' and tenant_id = 't' and status = 'SCHEDULED'");
  });

  it("every post-claim write is ONE conditional update: id, tenant, status FAILED and the attempt's own note, exactly one row", () => {
    const body = functionBody(launch, "writeFenced");
    expect(body).toContain('.eq("id", channelCampaignId)');
    expect(body).toContain('.eq("tenant_id", tenantId)');
    expect(body).toContain('.eq("status", "FAILED")');
    expect(body).toContain('.eq("error", fence.note)');
    expect(body).toContain("data.length === 1");
    expect(body).not.toContain("updated_at");
    expect(squash(stmt.progress("i", "t", { error: "e" }, "n"))).toContain(
      "where id = 'i' and tenant_id = 't' and status = 'FAILED' and error = 'n'",
    );
    // progress and failure writes cannot bypass the fence
    expect(functionBody(launch, "persistLaunchProgress")).toContain("writeFenced(");
    expect(functionBody(launch, "recordLaunchFailure")).toContain("writeFenced(");
  });

  it("no update on prompter_channel_campaigns after the claim bypasses writeFenced", () => {
    const afterClaim = launch.slice(launch.indexOf("const claim = await claimChannelCampaignLaunch"));
    const updates = afterClaim.match(/\.update\(/g) ?? [];
    // the claim helper, and the single update inside writeFenced
    expect(updates.length).toBe(2);
  });

  it("failure write: fenced; releasable branch returns to SCHEDULED with a cleared id; other failures never null an existing id", () => {
    const body = functionBody(launch, "recordLaunchFailure");
    expect(body).toContain('{ status: "SCHEDULED", error: null, external_campaign_id: null }');
    expect(body).toContain("...(outcome.externalCampaignId ? { external_campaign_id: outcome.externalCampaignId } : {})");
    expect(squash(stmt.release("i", "t", "n"))).toContain("set status = 'SCHEDULED', error = null, external_campaign_id = null");
    expect(squash(stmt.release("i", "t", "n"))).toContain("and status = 'FAILED' and error = 'n'");
    expect(squash(stmt.fail("i", "t", "m", null, "n"))).toContain("and status = 'FAILED' and error = 'n'");
    expect(squash(stmt.fail("i", "t", "m", null, "n"))).not.toContain("external_campaign_id");
  });

  it("the final status write (PAUSED for Meta, via statusAfterSuccessfulLaunch) goes through the fenced progress helper", () => {
    expect(squash(launch)).toContain(
      'await persistLaunchProgress( supabase, session.tenantId, channelCampaignId, fence, { status: statusAfterSuccessfulLaunch(connectorPlatform), error: null }, "result", );',
    );
  });

  it("no fixture statement uses updated_at", () => {
    const all = [
      stmt.claim("i", "t"),
      stmt.progress("i", "t", { error: "e" }, "n"),
      stmt.release("i", "t", "n"),
      stmt.fail("i", "t", "m", "x", "n"),
    ].join(" ");
    expect(all).not.toMatch(/updated_at/i);
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
