import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PsqlSession, closeAllSessions } from "./psql-session";
import { resolvePgConfig } from "./pg-env";
import {
  IN_PROGRESS_NOTE,
  getRow,
  interpretClaim,
  openPool,
  pgEnabled,
  seedRow,
  stmt,
  type SessionPool,
} from "./fixture";

/**
 * C10 — CHARACTERIZATION tests of known, documented windows. They assert what
 * the system does TODAY. A failure here means behaviour changed (possibly a
 * fix): review and update deliberately, do not "make it green" blindly.
 * Each "KNOWN GAP" is a finding for the pre-S1 hardening PRs; "FIXED BY H2" marks
 * a former gap that H2 closed (the assertion was reversed deliberately).
 */
describe.skipIf(!pgEnabled)("C10 characterization of known gaps", () => {
  let pool: SessionPool;
  beforeAll(async () => {
    pool = await openPool(resolvePgConfig());
  });
  afterAll(async () => {
    await closeAllSessions();
  });
  const exec = (sql: string) => pool.admin.exec(sql);

  it("KNOWN GAP (Emergency Stop, database layer): PostgreSQL does not enforce the stop after the claim; since H2 the APPLICATION re-reads it strictly before every create", async () => {
    const tenant = randomUUID();
    const id = await seedRow(pool.admin, { tenant });
    await exec(`insert into prompter_automation_settings (tenant_id, emergency_stop_active) values ('${tenant}', false);`);

    expect(interpretClaim(await exec(stmt.claim(id, tenant)))).toBe(true);
    // The Founder presses Emergency Stop while the launch is between two Meta creates.
    await exec(`update prompter_automation_settings set emergency_stop_active = true where tenant_id = '${tenant}';`);

    // Nothing in PostgreSQL consults the flag: the launch keeps progressing and ends ACTIVE.
    expect(interpretClaim(await exec(stmt.progress(id, tenant, { external_campaign_id: "camp-1", error: "p" }, IN_PROGRESS_NOTE)))).toBe(true);
    expect(interpretClaim(await exec(stmt.progress(id, tenant, { status: "ACTIVE", error: null }, "p")))).toBe(true);
    expect((await getRow(pool.admin, id)).status).toBe("ACTIVE");
  });

  it("KNOWN GAP (Emergency Stop): the claim itself is not blocked by the flag at the database layer (the app checks before claiming)", async () => {
    const tenant = randomUUID();
    const id = await seedRow(pool.admin, { tenant });
    await exec(`insert into prompter_automation_settings (tenant_id, emergency_stop_active) values ('${tenant}', true);`);
    expect(interpretClaim(await exec(stmt.claim(id, tenant)))).toBe(true);
  });

  it("KNOWN GAP (audit loss): the final write clears the in-progress note; a crash before the success audit leaves ACTIVE with no audit row", async () => {
    const tenant = randomUUID();
    const id = await seedRow(pool.admin, { tenant });
    const launcher = await PsqlSession.open(pool.cfg, "c10-audit");
    expect(interpretClaim(await launcher.exec(stmt.claim(id, tenant)))).toBe(true);
    expect(interpretClaim(await launcher.exec(stmt.progress(id, tenant, { status: "ACTIVE", error: null }, IN_PROGRESS_NOTE)))).toBe(true);
    await launcher.crash(); // dies before writeLaunchAudit()

    const row = await getRow(pool.admin, id);
    expect(row).toMatchObject({ status: "ACTIVE", error: null });
    const audits = await exec(`select count(*) from prompter_audit_logs where resource_id = '${id}';`);
    expect(audits.rows[0]).toBe("0");
  });

  it("KNOWN GAP (audit best-effort): an audit insert that fails does not undo the ACTIVE row", async () => {
    const tenant = randomUUID();
    const id = await seedRow(pool.admin, { tenant });
    await exec(stmt.claim(id, tenant));
    await exec(stmt.progress(id, tenant, { status: "ACTIVE", error: null }, IN_PROGRESS_NOTE));
    // Violates NOT NULL (action): the app treats audit as best-effort and carries on.
    const audit = await exec(
      `insert into prompter_audit_logs (tenant_id, action, resource_type, resource_id) values ('${tenant}', null, 'x', '${id}');`,
    );
    expect(audit.error).toMatch(/null value|not-null/i);
    expect((await getRow(pool.admin, id)).status).toBe("ACTIVE");
  });

  it("FIXED BY H2 (claim token): if a claimed row is re-armed to SCHEDULED and claimed again, the first launcher's late write matches NOTHING and cannot touch the new claim", async () => {
    const tenant = randomUUID();
    const id = await seedRow(pool.admin, { tenant });
    const noteA = `${IN_PROGRESS_NOTE} [LNE:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa]`;
    const noteB = `${IN_PROGRESS_NOTE} [LNE:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb]`;
    expect(interpretClaim(await exec(stmt.claim(id, tenant, noteA)))).toBe(true); // launcher A
    await exec(`update prompter_channel_campaigns set status = 'SCHEDULED', error = null where id = '${id}';`); // manual re-arm
    expect(interpretClaim(await exec(stmt.claim(id, tenant, noteB)))).toBe(true); // launcher B

    // Launcher A (stale) is told apart from B: the predicate also requires A's own note.
    const lateA = await exec(stmt.progress(id, tenant, { external_campaign_id: "from-A", error: noteA }, noteA));
    expect(interpretClaim(lateA)).toBe(false);
    expect(interpretClaim(await exec(stmt.release(id, tenant, noteA)))).toBe(false);
    expect(await getRow(pool.admin, id)).toMatchObject({ status: "FAILED", error: noteB, external_campaign_id: null });
  });

  it("documented fail-closed: a claimed row left FAILED + note (crash after claim) is never auto-released and rejects another claim", async () => {
    const tenant = randomUUID();
    const id = await seedRow(pool.admin, { tenant });
    await exec(stmt.claim(id, tenant));
    expect(interpretClaim(await exec(stmt.claim(id, tenant)))).toBe(false);
    expect((await getRow(pool.admin, id)).error).toBe(IN_PROGRESS_NOTE);
  });
});
