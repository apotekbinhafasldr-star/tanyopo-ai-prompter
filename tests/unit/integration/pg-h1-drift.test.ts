import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STATUS_TRANSITIONS } from "@/services/channel-campaigns";
import { PRODUCTION_ONLY_TABLES } from "../../integration/pg/pg-env";
import { FIXTURE_APPROVALS, FIXTURE_MASTERS, H1_TRANSITIONS, h1 } from "../../integration/pg/fixture";

/**
 * Keeps the H1 / PR #39 PostgreSQL (C11) statements honest: they must stay the
 * equivalent of what the application really sends. Runs in the normal unit job.
 */
const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const squash = (s: string) => s.replace(/\s+/g, " ");

describe("C11 SQL mirrors the application (H1)", () => {
  const service = squash(read("services/channel-campaigns.ts"));
  const approvals = squash(read("features/approvals/actions.ts"));

  it("the fixture's transition table is the application's", () => {
    expect(H1_TRANSITIONS).toEqual(STATUS_TRANSITIONS);
  });

  it("mirror: channel table, master id AND tenant AND source status, set to the target, exactly the app's predicates", () => {
    expect(service).toContain('.from("prompter_channel_campaigns") .update({ status: to }) .eq("master_campaign_id", masterCampaignId) .eq("tenant_id", tenantId) .eq("status", from) .select("id")');
    const sql = squash(h1.mirror("m", "t", "APPROVE"));
    expect(sql).toContain("update prompter_channel_campaigns set status = 'SCHEDULED'");
    expect(sql).toContain("where master_campaign_id = 'm' and tenant_id = 't' and status = 'AWAITING_APPROVAL'");
  });

  it("master: id AND tenant AND source status, exactly one row", () => {
    expect(service).toContain('.from("prompter_master_campaigns") .update({ status: to }) .eq("id", masterCampaignId) .eq("tenant_id", tenantId) .eq("status", from) .select("id")');
    expect(service).toContain("data.length === 1");
    expect(squash(h1.master("m", "t", "CANCEL"))).toContain("where id = 'm' and tenant_id = 't' and status = 'AWAITING_APPROVAL'");
  });

  it("decision claim: id AND tenant AND PENDING, exactly one row", () => {
    expect(approvals).toContain('.eq("id", approvalId) .eq("tenant_id", session.tenantId) .eq("status", "PENDING") .select("id")');
    expect(approvals).toContain("decidedRows.length !== 1");
    expect(squash(h1.decide("a", "t", "APPROVED"))).toContain("where id = 'a' and tenant_id = 't' and status = 'PENDING'");
  });

  it("flow order in the application: pre-flight -> claim -> master -> mirror+verify -> audit, each fail-closed", () => {
    const pre = approvals.indexOf('checkChannelCampaignState(supabase, session.tenantId, approval.resource_id, transition, "before")');
    const claim = approvals.indexOf('.eq("status", "PENDING")');
    const master = approvals.indexOf("transitionMasterCampaign(supabase");
    const mirror = approvals.indexOf("mirrorChannelCampaignStatus(supabase");
    const audit = approvals.indexOf('action: decision === "APPROVED" ? "campaign.approved"');
    expect(pre).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(pre);
    expect(master).toBeGreaterThan(claim);
    expect(mirror).toBeGreaterThan(master);
    expect(audit).toBeGreaterThan(mirror);
    expect(approvals).toContain('if (masterOutcome !== "moved") {');
    expect(approvals).toContain("if (!isMirrorConfirmed(mirrored)) {");
    expect(approvals).toContain("if (!before.consistent) {");
  });

  it("the post-mirror verification and the pre-flight accept exactly: target (after) / source or target (before) plus locked statuses", () => {
    expect(service).toContain('const accepted: readonly string[] = phase === "before" ? [from, to] : [to];');
    expect(service).toContain('["FAILED", "ACTIVE", "PAUSED", "COMPLETED"]');
    expect(service).toContain("!accepted.includes(r.status) && !locked.includes(r.status)");
    expect(service).toContain('const check = await checkChannelCampaignState(supabase, tenantId, masterCampaignId, transition, "after");');
    // tenant-scoped reads
    expect(service).toContain('.from("prompter_channel_campaigns") .select("channel, status") .eq("master_campaign_id", masterCampaignId) .eq("tenant_id", tenantId)');
    expect(service).toContain('.from("prompter_master_campaigns") .select("channels") .eq("id", masterCampaignId) .eq("tenant_id", tenantId)');
  });

  it("the fixture flow has the same order and exactly-one gates (and is not one transaction)", () => {
    const flow = h1.decideFlow("a", "m", "t", "APPROVED");
    const claim = flow.indexOf(`update ${FIXTURE_APPROVALS}`);
    const master = flow.indexOf(`update ${FIXTURE_MASTERS}`);
    const mirror = flow.indexOf("update prompter_channel_campaigns");
    const audit = flow.indexOf("insert into prompter_audit_logs");
    expect(claim).toBeLessThan(master);
    expect(master).toBeLessThan(mirror);
    expect(mirror).toBeLessThan(audit);
    expect(flow.match(/count\(\*\) = 1/g)).toHaveLength(2);
    expect(flow).not.toMatch(/\bdo\b|\bbegin\b/i);
  });

  it("the stand-in tables use non-production names", () => {
    expect(PRODUCTION_ONLY_TABLES as readonly string[]).not.toContain(FIXTURE_MASTERS);
    expect(PRODUCTION_ONLY_TABLES as readonly string[]).not.toContain(FIXTURE_APPROVALS);
    const schema = read("tests/integration/pg/schema.sql").replace(/^\s*--.*$/gm, "");
    for (const prod of PRODUCTION_ONLY_TABLES) expect(schema).not.toMatch(new RegExp(`create table ${prod}\\b`));
    expect(schema).toContain(`create table ${FIXTURE_MASTERS}`);
    expect(schema).toContain(`create table ${FIXTURE_APPROVALS}`);
  });

  it("the pre-H1 unsafe statements stay unsafe on purpose (they are the negative controls)", () => {
    expect(h1.unsafeMirror("m", "APPROVE")).not.toMatch(/tenant_id|status = 'AWAITING_APPROVAL'/);
    expect(h1.unsafeDecide("a", "APPROVED")).not.toMatch(/PENDING|tenant_id/);
  });
});
