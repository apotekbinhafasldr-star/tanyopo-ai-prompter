import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeAllSessions } from "./psql-session";
import { resolvePgConfig } from "./pg-env";
import {
  IN_PROGRESS_NOTE,
  getRow,
  interpretClaim,
  openPool,
  openSessions,
  pgEnabled,
  raceStatements,
  seedRow,
  stmt,
  waitForLockWaiters,
  winnersOf,
  type SessionPool,
} from "./fixture";

/**
 * C12 (H2-C): claim fencing. After the exclusive claim every write of one
 * launch attempt is conditional on `status = 'FAILED'` AND on the exact note
 * (it carries the attempt's nonce) that the SAME attempt wrote last.
 *
 * These tests run the statement-for-statement SQL equivalent of what the
 * application sends (see fixture.ts and pg-claim-drift.test.ts). The equality
 * semantics of the filter through a real PostgREST (URL encoding, special
 * characters, 25 concurrent writers) were demonstrated separately and are
 * reported in the PR description; PostgREST is not part of this CI job.
 */
const noteOf = (nonce: string) => `${IN_PROGRESS_NOTE} [LNE:${nonce}]`;
const NONCE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NONCE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe.skipIf(!pgEnabled)("C12 H2 claim fencing", () => {
  let pool: SessionPool;
  beforeAll(async () => {
    pool = await openPool(resolvePgConfig());
  });
  afterAll(async () => {
    await closeAllSessions();
  });
  const exec = (sql: string) => pool.admin.exec(sql);

  it("a whole attempt (claim, intent, result, intent, result ..., final) is a chain of single-row conditional writes", async () => {
    const tenant = randomUUID();
    const id = await seedRow(pool.admin, { tenant });
    let note = noteOf(NONCE_A);
    expect(interpretClaim(await exec(stmt.claim(id, tenant, note)))).toBe(true);

    const steps: { error: string; external_campaign_id?: string }[] = [
      { error: `${IN_PROGRESS_NOTE} langkah campaign (token LNE-AAAAAAAA-C) TIDAK PASTI [LNE:${NONCE_A}]` },
      { error: `Objek di Meta: campaign=111 [LNE:${NONCE_A}]`, external_campaign_id: "111" },
      { error: `${IN_PROGRESS_NOTE} langkah ad set (token LNE-AAAAAAAA-S) [LNE:${NONCE_A}]` },
      { error: `Objek di Meta: campaign=111, adset=222 [LNE:${NONCE_A}]` },
    ];
    for (const patch of steps) {
      const r = await exec(stmt.progress(id, tenant, patch, note));
      expect(r.error).toBeNull();
      expect(interpretClaim(r)).toBe(true);
      note = patch.error;
    }
    expect(interpretClaim(await exec(stmt.progress(id, tenant, { status: "ACTIVE", error: null }, note)))).toBe(true);
    expect(await getRow(pool.admin, id)).toMatchObject({ status: "ACTIVE", error: null, external_campaign_id: "111" });
  });

  const SPECIAL_NOTES: [string, string][] = [
    ["parentheses, commas, colons, semicolons", "Objek (semua PAUSED): campaign=1, adset=2; x:y"],
    ["quotes and backslashes", `he said "hi", it's 'ok' \\ back\\slash \\n literally`],
    ["percent, star, underscore, equals, ampersand, hash, plus", "100% sure_ * a=b&c#d+e %41 %2B"],
    ["PostgREST operator words", "eq.neq.in.(1,2).is.null.not.like.ilike.cs.cd"],
    ["dollar quotes and psql look-alikes", "$$ ; \\g \\c x :var :'v' $tag$ end"],
    ["unicode", "Peluncuran — dihentikan • Emergency Stop ñ é 日本語"],
    ["leading and trailing whitespace", "  keep my spaces  "],
    ["newline and tab", "line1\nline2\tTabbed"],
    ["a long note", `${"abc(def),".repeat(300)}[LNE:${NONCE_A}]`],
  ];

  for (const [label, special] of SPECIAL_NOTES) {
    it(`conditional write with special characters (${label}): exact note matches one row, a near miss matches none, a stale note none`, async () => {
      const tenant = randomUUID();
      const id = await seedRow(pool.admin, { tenant });
      expect(interpretClaim(await exec(stmt.claim(id, tenant, special)))).toBe(true);
      expect((await getRow(pool.admin, id)).error).toBe(special);

      // one character different, or a trailing space: no match, nothing written
      const nearMiss = await exec(stmt.progress(id, tenant, { error: "SHOULD-NOT-WRITE" }, `${special} `));
      expect(nearMiss.error).toBeNull();
      expect(interpretClaim(nearMiss)).toBe(false);
      expect((await getRow(pool.admin, id)).error).toBe(special);

      const next = `${special} [NEXT]`;
      expect(interpretClaim(await exec(stmt.progress(id, tenant, { error: next }, special)))).toBe(true);
      expect((await getRow(pool.admin, id)).error).toBe(next);

      // the previous note is stale now
      expect(interpretClaim(await exec(stmt.progress(id, tenant, { error: "STALE" }, special)))).toBe(false);
      expect((await getRow(pool.admin, id)).error).toBe(next);
    });
  }

  it("a stale launcher (after manual re-arm and a newer claim) writes nothing and cannot release the newer claim", async () => {
    const tenant = randomUUID();
    const id = await seedRow(pool.admin, { tenant });
    const noteA = noteOf(NONCE_A);
    const noteB = noteOf(NONCE_B);
    expect(interpretClaim(await exec(stmt.claim(id, tenant, noteA)))).toBe(true);
    await exec(`update prompter_channel_campaigns set status = 'SCHEDULED', error = null where id = '${id}';`);
    expect(interpretClaim(await exec(stmt.claim(id, tenant, noteB)))).toBe(true);

    for (const sql of [
      stmt.progress(id, tenant, { external_campaign_id: "from-A", error: noteA }, noteA),
      stmt.progress(id, tenant, { status: "ACTIVE", error: null }, noteA),
      stmt.fail(id, tenant, "A failed", "from-A", noteA),
      stmt.release(id, tenant, noteA),
    ]) {
      const r = await exec(sql);
      expect(r.error).toBeNull();
      expect(interpretClaim(r)).toBe(false);
    }
    expect(await getRow(pool.admin, id)).toMatchObject({ status: "FAILED", error: noteB, external_campaign_id: null });

    // B, the real owner, continues normally
    expect(interpretClaim(await exec(stmt.progress(id, tenant, { external_campaign_id: "from-B", error: "B-progress" }, noteB)))).toBe(true);
  });

  it("a stale write is rejected after a manual re-arm even when nobody claimed again (status no longer FAILED)", async () => {
    const tenant = randomUUID();
    const id = await seedRow(pool.admin, { tenant });
    const noteA = noteOf(NONCE_A);
    await exec(stmt.claim(id, tenant, noteA));
    await exec(`update prompter_channel_campaigns set status = 'SCHEDULED', error = null where id = '${id}';`);
    expect(interpretClaim(await exec(stmt.progress(id, tenant, { error: "x" }, noteA)))).toBe(false);
    expect(interpretClaim(await exec(stmt.release(id, tenant, noteA)))).toBe(false);
    expect(await getRow(pool.admin, id)).toMatchObject({ status: "SCHEDULED", error: null });
  });

  it("an administrator editing the note (same FAILED row) also fences the running launcher", async () => {
    const tenant = randomUUID();
    const id = await seedRow(pool.admin, { tenant });
    const noteA = noteOf(NONCE_A);
    await exec(stmt.claim(id, tenant, noteA));
    await exec(`update prompter_channel_campaigns set error = 'dicek manual oleh admin' where id = '${id}';`);
    expect(interpretClaim(await exec(stmt.progress(id, tenant, { external_campaign_id: "x", error: "y" }, noteA)))).toBe(false);
    expect(await getRow(pool.admin, id)).toMatchObject({ status: "FAILED", error: "dicek manual oleh admin", external_campaign_id: null });
  });

  it("tenant isolation: a write carrying another tenant matches nothing", async () => {
    const tenant = randomUUID();
    const other = randomUUID();
    const id = await seedRow(pool.admin, { tenant });
    const noteA = noteOf(NONCE_A);
    await exec(stmt.claim(id, tenant, noteA));
    for (const sql of [
      stmt.claim(id, other, noteOf(NONCE_B)),
      stmt.progress(id, other, { error: "x" }, noteA),
      stmt.fail(id, other, "x", "c", noteA),
      stmt.release(id, other, noteA),
    ]) {
      expect(interpretClaim(await exec(sql))).toBe(false);
    }
    expect((await getRow(pool.admin, id)).error).toBe(noteA);
  });

  for (const n of [2, 8, 16]) {
    it(`${n} concurrent writers presenting the same expected note: exactly one wins`, async () => {
      const tenant = randomUUID();
      const id = await seedRow(pool.admin, { tenant });
      const noteA = noteOf(NONCE_A);
      await exec(stmt.claim(id, tenant, noteA));
      const sessions = await openSessions(pool.cfg, n, `c12-same-${n}-`);
      try {
        const results = await raceStatements(
          pool,
          sessions,
          sessions.map((_, i) => stmt.progress(id, tenant, { error: `winner-${i}` }, noteA)),
        );
        expect(results.every((r) => r.error === null)).toBe(true);
        expect(winnersOf(results)).toBe(1);
        const row = await getRow(pool.admin, id);
        expect(row.error).toMatch(/^winner-\d+$/);
      } finally {
        await Promise.all(sessions.map((s) => s.close()));
      }
    });
  }

  it("a launcher blocked on the row lock re-evaluates its note after a manual re-arm commits and gets 0 rows", async () => {
    const tenant = randomUUID();
    const id = await seedRow(pool.admin, { tenant });
    const noteA = noteOf(NONCE_A);
    await exec(stmt.claim(id, tenant, noteA));
    const [admin2, launcherA] = await openSessions(pool.cfg, 2, "c12-lock-");
    try {
      const pidA = await launcherA.backendPid();
      await admin2.exec("begin;");
      const rearm = await admin2.exec(
        `update prompter_channel_campaigns set status = 'SCHEDULED', error = null where id = '${id}' returning id;`,
      );
      expect(interpretClaim(rearm)).toBe(true);

      let settled = false;
      const staleRun = launcherA
        .exec(stmt.progress(id, tenant, { external_campaign_id: "from-A", error: "A2" }, noteA))
        .then((r) => {
          settled = true;
          return r;
        });
      await waitForLockWaiters(pool.admin, [pidA]);
      expect(settled).toBe(false);

      await admin2.exec("commit;");
      const stale = await staleRun;
      expect(stale.error).toBeNull();
      expect(interpretClaim(stale)).toBe(false);
      expect(await getRow(pool.admin, id)).toMatchObject({ status: "SCHEDULED", error: null, external_campaign_id: null });
    } finally {
      await Promise.all([admin2.close(), launcherA.close()]);
    }
  });

  it("race: a stale launcher's write, a manual re-arm and a new claim (15 rounds): the stale write never lands on the new claim", async () => {
    const sessions = await openSessions(pool.cfg, 3, "c12-race-");
    try {
      for (let round = 0; round < 15; round++) {
        const tenant = randomUUID();
        const id = await seedRow(pool.admin, { tenant });
        const noteA = noteOf(NONCE_A);
        const noteB = noteOf(NONCE_B);
        await exec(stmt.claim(id, tenant, noteA));
        const results = await raceStatements(pool, sessions, [
          stmt.progress(id, tenant, { external_campaign_id: "from-A", error: `${noteA} A2` }, noteA),
          `update prompter_channel_campaigns set status = 'SCHEDULED', error = null, external_campaign_id = null where id = '${id}' and status = 'FAILED' returning id;`,
          stmt.claim(id, tenant, noteB),
        ]);
        expect(results.every((r) => r.error === null)).toBe(true);
        const row = await getRow(pool.admin, id);
        // Whatever the interleaving, B's note must never carry A's external id.
        if (row.error === noteB) expect(row.external_campaign_id).toBeNull();
      }
    } finally {
      await Promise.all(sessions.map((s) => s.close()));
    }
  });

  it("the failure write never overwrites an existing external id with null (only a received id is written)", async () => {
    const tenant = randomUUID();
    const id = await seedRow(pool.admin, { tenant });
    const noteA = noteOf(NONCE_A);
    await exec(stmt.claim(id, tenant, noteA));
    expect(interpretClaim(await exec(stmt.progress(id, tenant, { external_campaign_id: "camp-1", error: "p1" }, noteA)))).toBe(true);
    expect(interpretClaim(await exec(stmt.fail(id, tenant, "gagal di langkah ad set", null, "p1")))).toBe(true);
    expect(await getRow(pool.admin, id)).toMatchObject({
      status: "FAILED",
      error: "gagal di langkah ad set",
      external_campaign_id: "camp-1",
    });
  });

  it("the release (nothing created) only works for the attempt that owns the claim, and the row is claimable exactly once afterwards", async () => {
    const tenant = randomUUID();
    const id = await seedRow(pool.admin, { tenant });
    const noteA = noteOf(NONCE_A);
    await exec(stmt.claim(id, tenant, noteA));
    expect(interpretClaim(await exec(stmt.release(id, tenant, noteOf(NONCE_B))))).toBe(false); // someone else's note
    expect(interpretClaim(await exec(stmt.release(id, tenant, noteA)))).toBe(true);
    expect(interpretClaim(await exec(stmt.claim(id, tenant, noteOf(NONCE_B))))).toBe(true);
    expect(interpretClaim(await exec(stmt.claim(id, tenant, noteOf(NONCE_A))))).toBe(false);
  });

  it("no statement used for fencing refers to updated_at", () => {
    const sample = [
      stmt.claim("i", "t", "n"),
      stmt.progress("i", "t", { error: "e" }, "n"),
      stmt.release("i", "t", "n"),
      stmt.fail("i", "t", "m", "x", "n"),
    ].join(" ");
    expect(sample).not.toMatch(/updated_at/i);
  });

  describe("negative controls (statements the application NEVER sends)", () => {
    it("status-only progress (the pre-H2 predicate) lets a stale launcher write into a newer claim", async () => {
      const tenant = randomUUID();
      const id = await seedRow(pool.admin, { tenant });
      const noteA = noteOf(NONCE_A);
      const noteB = noteOf(NONCE_B);
      await exec(stmt.claim(id, tenant, noteA));
      await exec(`update prompter_channel_campaigns set status = 'SCHEDULED', error = null where id = '${id}';`);
      await exec(stmt.claim(id, tenant, noteB));

      const unsafe = await exec(stmt.unsafeProgressStatusOnly(id, tenant, { external_campaign_id: "from-A", error: noteA }));
      expect(interpretClaim(unsafe)).toBe(true); // the defect H2 removes
      expect(await getRow(pool.admin, id)).toMatchObject({ error: noteA, external_campaign_id: "from-A" });
    });

    it("status-only release lets a stale launcher un-claim a newer attempt (re-arm hazard)", async () => {
      const tenant = randomUUID();
      const id = await seedRow(pool.admin, { tenant });
      await exec(stmt.claim(id, tenant, noteOf(NONCE_A)));
      await exec(`update prompter_channel_campaigns set status = 'SCHEDULED', error = null where id = '${id}';`);
      await exec(stmt.claim(id, tenant, noteOf(NONCE_B)));

      const unsafe = await exec(stmt.unsafeReleaseStatusOnly(id, tenant));
      expect(interpretClaim(unsafe)).toBe(true);
      expect((await getRow(pool.admin, id)).status).toBe("SCHEDULED"); // B's in-flight launch is now re-armable
    });
  });
});
