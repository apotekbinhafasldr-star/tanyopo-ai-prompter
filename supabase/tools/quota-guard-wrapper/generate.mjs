#!/usr/bin/env node
// AI-jobs quota-guard migration wrapper generator (sibling of supabase/tools/s1-wrapper; that tool and its manifest are
// NOT touched). Turns ONE of exactly two reviewed migration files into ONE SQL string that applies the file AND writes
// its row in supabase_migrations.schema_migrations (explicit version) inside a single transaction, so the SQL and the
// ledger either both happen or neither does.
//
// What this tool is NOT: it never connects to a database, never executes anything, never accepts SQL or a file path from
// its caller, never writes a manifest, never applies "all pending" migrations. It prints SQL for a human to review;
// running it against Production needs separate Founder approval PER FILE (see docs/AI_JOBS_QUOTA_GUARD_RUNBOOK.md).
//
// Safety layers (each independent):
//   1. Allowlist  - the two versions + file names are constants in THIS file (not in the manifest).
//   2. Manifest   - sha256 of each migration, rollback and read-only check file, locked in manifest.json.
//   3. Static     - no transaction control / psql meta-commands / role switching inside the migration; no tag collisions.
//   4. In the DB  - the generated SQL re-checks the ledger, S1 prerequisites and the exact pre-state (RPC md5, triggers),
//                   proves ONE transaction, proves NO privilege and NO row count changed, verifies the exact end state
//                   (RPC md5, trigger shapes, guard-function ACL), writes the ledger and re-reads it byte for byte.
//
// Usage:
//   node supabase/tools/quota-guard-wrapper/generate.mjs list
//   node supabase/tools/quota-guard-wrapper/generate.mjs verify
//   node supabase/tools/quota-guard-wrapper/generate.mjs checksums
//   node supabase/tools/quota-guard-wrapper/generate.mjs generate <version> [--out <new-file>]

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const GENERATOR_VERSION = "1";

export const ALLOWLIST = Object.freeze([
  Object.freeze({
    version: "20261021120000",
    file: "20261021120000_prompter_ai_jobs_quota_guard.sql",
    name: "prompter_ai_jobs_quota_guard",
    rollback: "20261021120000_prompter_ai_jobs_quota_guard.down.sql",
  }),
  Object.freeze({
    version: "20261021120100",
    file: "20261021120100_prompter_ai_jobs_delete_guard.sql",
    name: "prompter_ai_jobs_delete_guard",
    rollback: "20261021120100_prompter_ai_jobs_delete_guard.down.sql",
  }),
]);

/** S1 versions that must already be in the ledger (and whose effect must be visible) before either guard file. */
export const S1_VERSIONS = Object.freeze(["20261019100000", "20261019100100", "20261019100200"]);

const RPC_SIGNATURE = "public.fn_create_ai_job_if_entitled(text,jsonb)";
const LEDGER = "supabase_migrations.schema_migrations";
const ADVISORY_KEY = "linoe:quota-guard-wrapper";
const LOCK_TIMEOUT = "3s";
const HEX32 = /^[0-9a-f]{32}$/;
const HEX64 = /^[0-9a-f]{64}$/;

// pg_trigger.tgtype bits: ROW=1 BEFORE=2 INSERT=4 DELETE=8 UPDATE=16 TRUNCATE=32
const TRIGGERS = Object.freeze({
  immutable: { name: "trg_prompter_ai_jobs_immutable", fn: "fn_guard_ai_job_immutable", tgtype: 19 }, // ROW|BEFORE|UPDATE
  no_truncate: { name: "trg_prompter_ai_jobs_no_truncate", fn: "fn_guard_ai_job_truncate", tgtype: 34 }, // BEFORE|TRUNCATE (statement)
  no_delete: { name: "trg_prompter_ai_jobs_no_delete", fn: "fn_guard_ai_job_delete", tgtype: 11 }, // ROW|BEFORE|DELETE
});

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const DEFAULT_MIGRATIONS_DIR = resolve(HERE, "../../migrations");
const DEFAULT_ROLLBACK_DIR = resolve(HERE, "../../rollback");
const DEFAULT_MANIFEST_PATH = join(HERE, "manifest.json");

export class WrapperError extends Error {}
const fail = (msg) => {
  throw new WrapperError(msg);
};

const sha256Hex = (buf) => createHash("sha256").update(buf).digest("hex");
const sqlLit = (s) => `'${String(s).replace(/'/g, "''")}'`;

const FORBIDDEN_LINES = [
  [/^\s*begin\s*(;|\s+(work|transaction)\b)/im, "BEGIN (transaction control)"],
  [/^\s*(start\s+transaction|commit|rollback|abort|savepoint|release|prepare\s+transaction)\b/im, "transaction control"],
  [/^\s*\\/m, "psql meta-command"],
  [/^\s*(set\s+(session\s+authorization|role)|reset\s+(role|session\s+authorization))\b/im, "role switching"],
];

/** Tokens that must never appear in the READ-ONLY check files (comments stripped first). */
const READONLY_FORBIDDEN =
  /\b(insert|update|delete|truncate|create|alter|drop|grant|revoke|comment|copy|vacuum|reindex|cluster|refresh|lock|call|do|execute|set|reset|listen|notify|merge)\b/i;

export function loadManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    return fail(`manifest unreadable: ${e.message}`);
  }
  const want = ALLOWLIST.map((m) => m.version).sort();
  const files = manifest && manifest.files;
  if (!files || typeof files !== "object") return fail("manifest has no files map");
  if (JSON.stringify(Object.keys(files).sort()) !== JSON.stringify(want)) return fail("manifest versions != allowlist");
  for (const m of ALLOWLIST) {
    const e = files[m.version];
    if (!e || e.file !== m.file || e.rollback !== m.rollback) return fail(`manifest names for ${m.version} differ from the allowlist`);
    for (const k of ["sha256", "rollbackSha256"]) if (!HEX64.test(e[k] || "")) return fail(`manifest ${k} for ${m.version} is malformed`);
    if (!Number.isInteger(e.bytes) || e.bytes <= 0) return fail(`manifest bytes for ${m.version} is malformed`);
  }
  const exp = manifest.expect;
  for (const k of ["rpcMd5Before", "rpcMd5AfterPart1"]) if (!exp || !HEX32.test(exp[k] || "")) return fail(`manifest expect.${k} is malformed`);
  if (JSON.stringify(manifest.s1Versions) !== JSON.stringify(S1_VERSIONS)) return fail("manifest s1Versions != generator constant");
  const ro = manifest.readonly;
  for (const k of ["preflight", "postflight"]) {
    if (!ro || !ro[k] || !/^[A-Za-z0-9_.-]+\.sql$/.test(ro[k].file || "") || !HEX64.test(ro[k].sha256 || "")) return fail(`manifest readonly.${k} is malformed`);
  }
  return manifest;
}

/** Reads the one allowlisted migration for `version` and proves it is exactly the locked source. */
export function readLockedSource(version, { migrationsDir = DEFAULT_MIGRATIONS_DIR, manifest } = {}) {
  const entry = ALLOWLIST.find((m) => m.version === version);
  if (typeof version !== "string" || !entry) {
    return fail(`version ${JSON.stringify(version)} is not allowed; allowed: ${ALLOWLIST.map((m) => m.version).join(", ")}`);
  }
  const man = manifest ?? loadManifest();
  const locked = man.files[version];
  const sameVersion = readdirSync(migrationsDir).filter((f) => f.startsWith(`${version}_`) || f === `${version}.sql`);
  if (sameVersion.length !== 1 || sameVersion[0] !== entry.file) {
    return fail(`expected exactly [${entry.file}] for version ${version}, found ${JSON.stringify(sameVersion)}`);
  }
  const full = join(migrationsDir, entry.file);
  const st = lstatSync(full);
  if (!st.isFile() || st.isSymbolicLink()) return fail(`${entry.file} is not a regular file`);
  const buf = readFileSync(full);
  if (buf.length !== locked.bytes) return fail(`${entry.file}: size ${buf.length} != locked ${locked.bytes}`);
  const digest = sha256Hex(buf);
  if (digest !== locked.sha256) return fail(`${entry.file}: sha256 ${digest} != locked ${locked.sha256}`);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return fail(`${entry.file} is not valid UTF-8`);
  }
  if (text.includes("\u0000")) return fail(`${entry.file} contains a NUL byte`);
  for (const [re, label] of FORBIDDEN_LINES) if (re.test(text)) return fail(`${entry.file} contains forbidden ${label}`);
  return { entry, text, sha256: digest };
}

/** Verifies the rollback files and the read-only check files against the manifest. */
export function verifyAuxiliary({ rollbackDir = DEFAULT_ROLLBACK_DIR, toolsDir = HERE, manifest } = {}) {
  const man = manifest ?? loadManifest();
  const out = [];
  for (const m of ALLOWLIST) {
    const b = readFileSync(join(rollbackDir, m.rollback));
    if (sha256Hex(b) !== man.files[m.version].rollbackSha256) return fail(`${m.rollback}: sha256 differs from the manifest`);
    if (/\bgrant\b/i.test(b.toString("utf8").replace(/--.*$/gm, ""))) return fail(`${m.rollback} contains GRANT`);
    out.push(m.rollback);
  }
  for (const k of ["preflight", "postflight"]) {
    const e = man.readonly[k];
    const text = readFileSync(join(toolsDir, e.file), "utf8");
    if (sha256Hex(Buffer.from(text, "utf8")) !== e.sha256) return fail(`${e.file}: sha256 differs from the manifest`);
    const stripped = text.replace(/--.*$/gm, "").replace(/'(?:[^']|'')*'/g, "''");
    const hit = stripped.match(READONLY_FORBIDDEN);
    if (hit) return fail(`${e.file} is not read-only: contains "${hit[0]}"`);
    if (!/^\s*(select|with)\b/i.test(stripped.trim())) return fail(`${e.file} must start with SELECT/WITH`);
    out.push(e.file);
  }
  return out;
}

// ---- SQL building blocks (constants of this file or derived from the locked checksum / manifest) ------------------------
const roleName = `CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END`;
/** One text row per table/column ACL entry of prompter_ai_jobs plus the RPC's owner/ACL. A change in any row = STOP. */
const ACL_ROWS = `SELECT 'tbl|' || ${roleName} || '|' || a.privilege_type AS r
      FROM pg_class c, LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
      WHERE c.oid = 'public.prompter_ai_jobs'::regclass
      UNION ALL
      SELECT 'col|' || att.attname || '|' || ${roleName} || '|' || a.privilege_type
      FROM pg_attribute att, LATERAL aclexplode(att.attacl) a
      WHERE att.attrelid = 'public.prompter_ai_jobs'::regclass AND att.attnum > 0 AND NOT att.attisdropped AND att.attacl IS NOT NULL
      UNION ALL
      SELECT 'rpc|' || pg_get_userbyid(p.proowner) || '|' || ${roleName} || '|' || a.privilege_type
      FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
      WHERE p.oid = to_regprocedure(${sqlLit(RPC_SIGNATURE)})`;
const rpcMd5 = `COALESCE(md5(pg_get_functiondef(to_regprocedure(${sqlLit(RPC_SIGNATURE)}))), 'absent')`;
const jobsRows = `(SELECT count(*) FROM public.prompter_ai_jobs)`;
const trgCount = `(SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.prompter_ai_jobs'::regclass AND NOT tgisinternal)`;
const guardFnCount = `(SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'fn\\_guard\\_ai\\_job%')`;

const markerFor = (entry, sha) => `qg-wrap:${entry.version}:${sha.slice(0, 12)}`;
const markerAssert = (marker) => `IF current_setting('qg.wrap', true) IS DISTINCT FROM ${sqlLit(marker)} THEN
    RAISE EXCEPTION 'STOP[not-single-transaction]: statements are not running inside one transaction; aborting';
  END IF;`;

function triggerShape(t) {
  return `(SELECT count(*) FROM pg_trigger x
      WHERE x.tgrelid = 'public.prompter_ai_jobs'::regclass AND x.tgname = ${sqlLit(t.name)} AND NOT x.tgisinternal
        AND x.tgenabled = 'O' AND x.tgtype = ${t.tgtype}
        AND x.tgfoid = ${sqlLit(`public.${t.fn}()`)}::regprocedure) = 1`;
}
function guardFnChecks(t) {
  const f = sqlLit(`public.${t.fn}()`);
  return `IF (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = ${f}::regprocedure) THEN
    RAISE EXCEPTION 'STOP[guard-fn]: ${t.fn} must be SECURITY INVOKER';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
             WHERE p.oid = ${f}::regprocedure AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated'))) THEN
    RAISE EXCEPTION 'STOP[guard-fn]: ${t.fn} is executable by PUBLIC/anon/authenticated';
  END IF;`;
}

function precheckBlock(entry, idx, marker, exp) {
  const earlier = ALLOWLIST.slice(0, idx).map((m) => m.version);
  const later = ALLOWLIST.slice(idx + 1).map((m) => m.version);
  const arr = (a) => (a.length ? `ARRAY[${a.map(sqlLit).join(",")}]::text[]` : "ARRAY[]::text[]");
  const s1 = arr([...S1_VERSIONS]);
  const stateChecks =
    entry.version === "20261021120000"
      ? `IF ${rpcMd5} IS DISTINCT FROM ${sqlLit(exp.rpcMd5Before)} THEN
    RAISE EXCEPTION 'STOP[rpc-drift]: fn_create_ai_job_if_entitled is not the expected live (B10) body; re-plan before applying';
  END IF;
  IF ${trgCount} <> 0 OR ${guardFnCount} <> 0 THEN
    RAISE EXCEPTION 'STOP[state-drift]: triggers/guard functions already exist on prompter_ai_jobs without a ledger row';
  END IF;`
      : `IF ${rpcMd5} IS DISTINCT FROM ${sqlLit(exp.rpcMd5AfterPart1)} THEN
    RAISE EXCEPTION 'STOP[rpc-drift]: part 1 is not live in its expected form (RPC md5 differs)';
  END IF;
  IF ${trgCount} <> 2 OR NOT ${triggerShape(TRIGGERS.immutable)} OR NOT ${triggerShape(TRIGGERS.no_truncate)} OR ${guardFnCount} <> 2 THEN
    RAISE EXCEPTION 'STOP[state-drift]: expected exactly the two part-1 triggers before part 2';
  END IF;`;
  return `DO $qgpre$
BEGIN
  IF to_regclass(${sqlLit(LEDGER)}) IS NULL THEN
    RAISE EXCEPTION 'STOP[ledger-missing]: ${LEDGER} not found';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(${sqlLit(ADVISORY_KEY)}, 0));
  PERFORM set_config('qg.wrap', ${sqlLit(marker)}, true);
  IF EXISTS (SELECT 1 FROM ${LEDGER} WHERE version = ${sqlLit(entry.version)}) THEN
    RAISE EXCEPTION 'STOP[already-recorded]: ${entry.version} is already in the ledger; nothing was executed';
  END IF;
  IF EXISTS (SELECT 1 FROM ${LEDGER} WHERE name = ${sqlLit(entry.name)}) THEN
    RAISE EXCEPTION 'STOP[name-recorded]: a ledger row named ${entry.name} already exists under another version';
  END IF;
  IF (SELECT count(*) FROM ${LEDGER} WHERE version = ANY(${s1})) <> ${S1_VERSIONS.length} THEN
    RAISE EXCEPTION 'STOP[s1-missing]: the three S1 versions are not all recorded in the ledger';
  END IF;
  IF (SELECT count(*) FROM ${LEDGER} WHERE version = ANY(${arr(earlier)})) <> ${earlier.length} THEN
    RAISE EXCEPTION 'STOP[prerequisite-missing]: earlier guard versions ${earlier.join(",") || "(none)"} are not all recorded';
  END IF;
  IF EXISTS (SELECT 1 FROM ${LEDGER} WHERE version = ANY(${arr(later)})) THEN
    RAISE EXCEPTION 'STOP[later-recorded]: a later guard version is already recorded (wrong order)';
  END IF;
  IF to_regclass('public.prompter_ai_jobs') IS NULL OR to_regprocedure(${sqlLit(RPC_SIGNATURE)}) IS NULL THEN
    RAISE EXCEPTION 'STOP[objects-missing]: prompter_ai_jobs or the RPC does not exist';
  END IF;
  -- S1 must be IN EFFECT, not just recorded: clients hold no INSERT/DELETE/TRUNCATE/table-UPDATE on prompter_ai_jobs.
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated']) r, unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE']) p
             WHERE has_table_privilege(r, 'public.prompter_ai_jobs', p)) THEN
    RAISE EXCEPTION 'STOP[s1-state]: S1 is recorded but a client role still holds a write privilege on prompter_ai_jobs';
  END IF;
  ${stateChecks}
  PERFORM set_config('qg.acl_before', COALESCE((SELECT string_agg(r, E'\\n' ORDER BY r) FROM (${ACL_ROWS}) q(r)), ''), true);
  PERFORM set_config('qg.rpc_before', ${rpcMd5}, true);
  PERFORM set_config('qg.rows_before', ${jobsRows}::text, true);
  PERFORM set_config('qg.trg_before', ${trgCount}::text, true);
END
$qgpre$;`;
}

function postcheckBlock(entry, marker, exp) {
  const part1 = entry.version === "20261021120000";
  const specific = part1
    ? `IF ${rpcMd5} IS DISTINCT FROM ${sqlLit(exp.rpcMd5AfterPart1)} THEN
    RAISE EXCEPTION 'STOP[rpc-mismatch]: RPC md5 after part 1 is not the locked value';
  END IF;
  IF position('ROLE_NOT_ALLOWED' IN pg_get_functiondef(to_regprocedure(${sqlLit(RPC_SIGNATURE)}))) = 0 THEN
    RAISE EXCEPTION 'STOP[rpc-mismatch]: role guard missing from the RPC';
  END IF;
  IF ${trgCount} <> 2 OR NOT ${triggerShape(TRIGGERS.immutable)} OR NOT ${triggerShape(TRIGGERS.no_truncate)} OR ${guardFnCount} <> 2 THEN
    RAISE EXCEPTION 'STOP[trigger]: part 1 trigger set is not exactly {immutable, no_truncate}';
  END IF;
  ${guardFnChecks(TRIGGERS.immutable)}
  ${guardFnChecks(TRIGGERS.no_truncate)}`
    : `IF ${rpcMd5} IS DISTINCT FROM current_setting('qg.rpc_before') THEN
    RAISE EXCEPTION 'STOP[rpc-changed]: part 2 must not touch the RPC';
  END IF;
  IF ${trgCount} <> 3 OR NOT ${triggerShape(TRIGGERS.immutable)} OR NOT ${triggerShape(TRIGGERS.no_truncate)} OR NOT ${triggerShape(TRIGGERS.no_delete)} OR ${guardFnCount} <> 3 THEN
    RAISE EXCEPTION 'STOP[trigger]: trigger set is not exactly {immutable, no_truncate, no_delete}';
  END IF;
  ${guardFnChecks(TRIGGERS.no_delete)}`;
  return `DO $qgpost$
DECLARE bad text;
BEGIN
  ${markerAssert(marker)}
  -- 1) no privilege may be added OR lost on prompter_ai_jobs (table, columns) or on the RPC; CREATE OR REPLACE keeps its ACL
  SELECT string_agg(r, '; ') INTO bad FROM (${ACL_ROWS}) q(r)
    WHERE r <> ALL (string_to_array(current_setting('qg.acl_before'), E'\\n'));
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'STOP[new-privilege]: privilege(s) appeared: %', bad; END IF;
  SELECT string_agg(b, '; ') INTO bad FROM unnest(string_to_array(current_setting('qg.acl_before'), E'\\n')) b
    WHERE b <> '' AND b <> ALL (ARRAY(SELECT r FROM (${ACL_ROWS}) q(r)));
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'STOP[lost-privilege]: privilege(s) disappeared: %', bad; END IF;
  -- 2) no data change: the guard migrations never write rows
  IF ${jobsRows} <> current_setting('qg.rows_before')::bigint THEN
    RAISE EXCEPTION 'STOP[rows-changed]: prompter_ai_jobs row count changed during the migration';
  END IF;
  -- 3) expected end state of THIS migration
  ${specific}
END
$qgpost$;`;
}

function ledgerInsert(entry, sha, text) {
  const tag = `$qgled_${sha.slice(0, 12)}$`;
  if (text.includes(tag)) fail("dollar-quote tag collision in migration text");
  return `INSERT INTO ${LEDGER} (version, name, statements)
VALUES (${sqlLit(entry.version)}, ${sqlLit(entry.name)}, ARRAY[${tag}${text}${tag}]::text[]);`;
}

function ledgerVerifyBlock(entry, idx, sha, marker) {
  const expected = ALLOWLIST.slice(0, idx + 1).map((m) => m.version).sort().join(",");
  const all = ALLOWLIST.map((m) => sqlLit(m.version)).join(",");
  return `DO $qgled$
DECLARE have text;
BEGIN
  ${markerAssert(marker)}
  IF (SELECT count(*) FROM ${LEDGER}
      WHERE version = ${sqlLit(entry.version)} AND name = ${sqlLit(entry.name)}
        AND cardinality(statements) = 1
        AND encode(sha256(convert_to(statements[1], 'UTF8')), 'hex') = ${sqlLit(sha)}) <> 1 THEN
    RAISE EXCEPTION 'STOP[ledger-verify]: ledger row for ${entry.version} is missing or differs from the locked source';
  END IF;
  SELECT string_agg(version, ',' ORDER BY version) INTO have FROM ${LEDGER} WHERE version IN (${all});
  IF have IS DISTINCT FROM ${sqlLit(expected)} THEN
    RAISE EXCEPTION 'STOP[ledger-verify]: guard versions in ledger are [%], expected [${expected}]', have;
  END IF;
END
$qgled$;`;
}

/** Builds the complete wrapper SQL for one allowlisted version. Pure: reads files, returns a string. */
export function buildWrapper(version, opts = {}) {
  const manifest = opts.manifest ?? loadManifest();
  const { entry, text, sha256 } = readLockedSource(version, { ...opts, manifest });
  const idx = ALLOWLIST.findIndex((m) => m.version === entry.version);
  const marker = markerFor(entry, sha256);
  for (const tag of ["$qgpre$", "$qgchk$", "$qgpost$", "$qgled$", "$qgled_"]) {
    if (text.includes(tag)) fail(`migration text contains reserved tag ${tag}`);
  }
  const exp = manifest.expect;
  const body = text.endsWith("\n") ? text : `${text}\n`;
  return `-- ===========================================================================================================
-- LINOE AI-jobs quota-guard wrapper (generator v${GENERATOR_VERSION}) - version ${entry.version} - ${entry.file}
-- source sha256 ${sha256}
-- ONE transaction: precheck -> migration -> privilege/state verification -> ledger INSERT -> ledger verification.
-- Send this ENTIRE text as ONE query (execute_sql / psql -c / SQL editor). Do NOT split it and do NOT add
-- BEGIN/COMMIT. If anything raises, nothing is applied and nothing is recorded. Review before use; the
-- migration text between the MIGRATION markers is the repository file, byte for byte.
-- Needs written Founder approval for THIS file before it is sent to Production.
-- ===========================================================================================================
SET LOCAL lock_timeout = '${LOCK_TIMEOUT}';
${precheckBlock(entry, idx, marker, exp)}
DO $qgchk$
BEGIN
  ${markerAssert(marker)}
END
$qgchk$;
-- QG-WRAPPER: MIGRATION BEGIN ${entry.file}
${body}-- QG-WRAPPER: MIGRATION END ${entry.file}
${postcheckBlock(entry, marker, exp)}
${ledgerInsert(entry, sha256, text)}
${ledgerVerifyBlock(entry, idx, sha256, marker)}
`;
}

function usage() {
  return [
    "usage:",
    "  generate.mjs list",
    "  generate.mjs verify",
    "  generate.mjs checksums",
    "  generate.mjs generate <version> [--out <new-file>]",
    `allowed versions: ${ALLOWLIST.map((m) => m.version).join(", ")}`,
  ].join("\n");
}

export function main(argv, io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) }) {
  const [cmd, ...rest] = argv;
  try {
    if (cmd === "list" && rest.length === 0) {
      const man = loadManifest();
      for (const m of ALLOWLIST) io.out(`${m.version}  ${m.file}  sha256=${man.files[m.version].sha256}\n`);
      return 0;
    }
    if (cmd === "verify" && rest.length === 0) {
      const man = loadManifest();
      for (const m of ALLOWLIST) {
        readLockedSource(m.version, { manifest: man });
        io.out(`OK  ${m.file}\n`);
      }
      for (const f of verifyAuxiliary({ manifest: man })) io.out(`OK  ${f}\n`);
      io.out("manifest verified: 2 migrations, 2 rollbacks, 2 read-only check files match the locked checksums\n");
      return 0;
    }
    if (cmd === "checksums" && rest.length === 0) {
      const man = loadManifest();
      const row = (dir, f) => {
        const buf = readFileSync(join(dir, f));
        io.out(`${sha256Hex(buf)}  ${buf.length}  ${f}\n`);
      };
      for (const m of ALLOWLIST) {
        row(DEFAULT_MIGRATIONS_DIR, m.file);
        row(DEFAULT_ROLLBACK_DIR, m.rollback);
      }
      for (const k of ["preflight", "postflight"]) row(HERE, man.readonly[k].file);
      return 0;
    }
    if (cmd === "generate") {
      const version = rest[0];
      let out = null;
      if (rest.length === 3 && rest[1] === "--out") out = rest[2];
      else if (rest.length !== 1) return (io.err(`${usage()}\n`), 2);
      const sql = buildWrapper(version);
      if (out) {
        const target = resolve(out);
        if (target.startsWith(DEFAULT_MIGRATIONS_DIR + sep) || existsSync(target)) {
          return fail("--out must be a NEW file outside supabase/migrations");
        }
        writeFileSync(target, sql, { flag: "wx" });
        io.err(`written ${target}\n`);
      } else {
        io.out(sql);
      }
      return 0;
    }
    io.err(`${usage()}\n`);
    return 2;
  } catch (e) {
    if (e instanceof WrapperError) {
      io.err(`REFUSED: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
