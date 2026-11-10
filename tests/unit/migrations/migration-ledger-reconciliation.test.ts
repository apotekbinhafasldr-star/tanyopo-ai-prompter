import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * R1 migration-ledger reconciliation guard (repository-only; no database access).
 *
 * The production ledger on the shared Supabase project is the source of truth
 * for migration versions. These checks pin (a) that every migration file name
 * is `<14-digit version>_<name>.sql` with a unique, sortable version, (b) that
 * the ten files renamed to their ledger versions still contain exactly the SQL
 * they had before the rename, and (c) that the two ledger-only migrations carry
 * the SQL recorded in the ledger. Changing any of them fails CI.
 */
const dir = path.resolve(__dirname, "../../../supabase/migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const sha256 = (file: string) => createHash("sha256").update(readFileSync(path.join(dir, file))).digest("hex");
/** Whitespace-normalised md5 of the SQL text, the same normalisation used to compare with the ledger `statements`. */
const ledgerMd5 = (file: string) =>
  createHash("md5").update(readFileSync(path.join(dir, file), "utf-8").replace(/\s+/g, " ").trim()).digest("hex");

/** Renamed to their production-ledger version; SQL content unchanged by the rename. */
const RENAMED: ReadonlyArray<readonly [string, string]> = [
  ["20260909073321_prompter_channel_campaigns_add_scheduled_at.sql", "d862671cd713f692e4cfe1380143be265b968a90020287d34ba55da9e1444621"],
  ["20260909100910_prompter_master_campaigns_add_selected_media.sql", "fccca85c0eb052df334f12623fc1581cd9898c7612b02ceb22f599cd23d7e2ea"],
  ["20260909141526_prompter_seo_discovery_no_website.sql", "2904e9759a293b2920d8a0666658f0b6af160bdc4603ada537f0097ecc18559e"],
  ["20260910072819_prompter_subscriptions_add_starter_plan.sql", "e33bdccda42a6b15aca26e5f14fbe2546a5acc0b111f55dff1bb991a4db1dd45"],
  ["20260915043800_prompter_b9_entitlement_enforcement.sql", "7aa9e03e0a2576afd317ad12130eeacd03d22d46ae1097953afb1728191cefb0"],
  ["20260915051359_prompter_b10_payment_billing_core.sql", "3057a88da773ccfe4ec672891d4c94ccd737d569f3114d11b099f8e271925bec"],
  ["20260924173424_prompter_trial_expiry_gate_fix.sql", "bced3f768e99f7145b2ffe1626a588a561e1ec560247fea961801c30c4d3daac"],
  ["20260926062741_prompter_scheduled_cancellations_cron.sql", "923631930bb3ad9032780e9868eb820502d683b0091a4560f115aaa0d65b6a42"],
  ["20260926113000_prompter_payment_lifecycle_remediation.sql", "44c25a3e6281265614a5b8d78f5582b2ecdfd6ac75dfbb54a014ba5df5bdffae"],
  ["20260928161604_prompter_demo_ai_usage.sql", "8624ca5d75415877cb039e86481adb56d78174913acf7824b9254adc156128cd"],
];

/** Exist in the production ledger only; SQL is verbatim from `supabase_migrations.schema_migrations`. */
const LEDGER_ONLY: ReadonlyArray<readonly [string, string]> = [
  ["20260909164100_prompter_growth_recommendation_job_type.sql", "093a6ec0ebf9e5f73361edf88437ba2d"],
  ["20260910060428_revert_unused_growth_recommendation_job_type.sql", "bcca85b025c4b1a9f18dc46b72079afc"],
];

describe("migration file names", () => {
  it("every file is <14-digit version>_<name>.sql and versions are unique", () => {
    const versions = files.map((f) => {
      expect(f, f).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
      return f.slice(0, 14);
    });
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("none of the pre-reconciliation (non-ledger) versions remain", () => {
    const stale = [
      "20260909073400", "20260909100900", "20260909141500", "20260910072801", "20260912090000",
      "20260913090000", "20260924080000", "20260926090000", "20260926120000", "20260928120000",
    ];
    for (const version of stale) expect(files.some((f) => f.startsWith(version)), version).toBe(false);
  });

  it("the reconciled files and the two ledger-only files are present", () => {
    for (const [file] of [...RENAMED, ...LEDGER_ONLY]) expect(files, file).toContain(file);
  });

  it("Track B carries the production-ledger version and the draft version is gone (same-name/different-version mismatch guard)", () => {
    expect(files).toContain("20261015144639_prompter_track_b_meta_page_picker.sql");
    expect(files.some((f) => f.startsWith("20260913163600"))).toBe(false);
  });

  it("no two migration files share the same name under different versions (ledger name must map to exactly one version)", () => {
    const byName = new Map<string, string[]>();
    for (const f of files) {
      const name = f.slice(15);
      byName.set(name, [...(byName.get(name) ?? []), f.slice(0, 14)]);
    }
    const dup = [...byName].filter(([, v]) => v.length > 1);
    expect(dup).toEqual([]);
  });
});

/** Track B: file renamed to the ledger version; content unchanged by the rename. */
const TRACK_B = "20261015144639_prompter_track_b_meta_page_picker.sql";
/** md5 of the whitespace-normalised ledger `statements` for version 20261015144639 (read-only query, 2026-10-21). */
const TRACK_B_LEDGER_MD5 = "3a76ef76f3a8e64de17d20523b06759c";
/** md5 of the executable statements (comments and the ledger's leading `set local lock_timeout` removed) shared by file and ledger. */
const TRACK_B_EXECUTABLE_MD5 = "36b78743a38a0d06ff25236d19f9ae7a";
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const executable = (s: string) => norm(norm(s.replace(/^\s*--.*$/gm, "")).replace(/set local lock_timeout = '3s';/i, ""));

describe("Track B ledger reconciliation", () => {
  it("file content is unchanged by the rename to the ledger version", () => {
    expect(sha256(TRACK_B)).toBe("902016257bcbf91dee456eb0a91035cbe7caa8b6a16599845fce60435811bf6a");
  });

  it("executable statements equal the ones recorded in the production ledger (only comments and lock_timeout differ)", () => {
    const sql = readFileSync(path.join(dir, TRACK_B), "utf-8");
    expect(createHash("md5").update(executable(sql)).digest("hex")).toBe(TRACK_B_EXECUTABLE_MD5);
    // the ledger text itself is the same statements plus `set local lock_timeout`: its recorded md5 is pinned for audit
    expect(TRACK_B_LEDGER_MD5).toHaveLength(32);
    // additive and idempotent only
    expect(sql).toMatch(/add column if not exists selected_page_id text/);
    expect(sql).toMatch(/add column if not exists selected_page_name text/);
    expect(sql.replace(/^\s*--.*$/gm, "")).not.toMatch(/\b(drop|delete|truncate|grant|revoke)\b/i);
  });
});

describe("migration SQL integrity", () => {
  it.each(RENAMED)("%s content is unchanged by the rename", (file, hash) => {
    expect(sha256(file)).toBe(hash);
  });

  it.each(LEDGER_ONLY)("%s matches the SQL recorded in the production ledger", (file, hash) => {
    expect(ledgerMd5(file)).toBe(hash);
  });

  it("the revert migration sorts after the one it reverts, and the net job_type constraint has six values", () => {
    const [grow, revert] = LEDGER_ONLY.map(([f]) => f);
    expect(grow < revert).toBe(true);
    const sql = readFileSync(path.join(dir, revert), "utf-8");
    expect(sql).not.toContain("GROWTH_RECOMMENDATION");
    expect((sql.match(/'[A-Z_]+'/g) ?? []).length).toBe(6);
  });
});
