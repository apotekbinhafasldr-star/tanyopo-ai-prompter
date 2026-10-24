#!/usr/bin/env node
// S1 migration wrapper generator.
//
// Purpose: turn ONE of exactly three reviewed migration files into ONE SQL string that applies the file AND writes
// its row in supabase_migrations.schema_migrations (explicit version) inside a single transaction, so the SQL and
// the ledger either both happen or neither does.
//
// What this tool is NOT: it never connects to a database, never executes anything, never accepts SQL or a file path
// from its caller, never writes a manifest and never applies "all pending" migrations. It prints SQL for a human to
// review; running it against Production needs separate Founder approval.
//
// Safety model (each layer is independent):
//   1. Allowlist     - the three versions + file names are constants in THIS file (not in the manifest).
//   2. Manifest      - sha256 of each file, locked in manifest.json; any difference refuses to generate.
//   3. Static guards - no transaction control / psql meta-commands / role switching inside the migration, and no
//                      collision with the wrapper's dollar-quote tags.
//   4. In the DB     - the generated SQL itself re-checks the ledger, proves it is running as ONE transaction,
//                      proves no privilege was ADDED beyond the migration's own allowed grants, verifies the
//                      expected end state, writes the ledger and verifies the ledger row byte-for-byte.
//
// Usage:
//   node supabase/tools/s1-wrapper/generate.mjs list
//   node supabase/tools/s1-wrapper/generate.mjs verify
//   node supabase/tools/s1-wrapper/generate.mjs checksums
//   node supabase/tools/s1-wrapper/generate.mjs generate <version> [--out <new-file>]

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const GENERATOR_VERSION = "1";

/** The ONLY migrations this tool will ever wrap. Order matters: each requires all earlier ones in the ledger. */
export const ALLOWLIST = Object.freeze([
  Object.freeze({
    version: "20261019100000",
    file: "20261019100000_prompter_p0_ai_jobs_lockdown.sql",
    name: "prompter_p0_ai_jobs_lockdown",
  }),
  Object.freeze({
    version: "20261019100100",
    file: "20261019100100_prompter_p0_subscription_trial_insert_guard.sql",
    name: "prompter_p0_subscription_trial_insert_guard",
  }),
  Object.freeze({
    version: "20261019100200",
    file: "20261019100200_prompter_p0_plan_entitlements_lockdown.sql",
    name: "prompter_p0_plan_entitlements_lockdown",
  }),
]);

/** Columns migration 20261019100000 grants UPDATE on (authenticated). Anything else is a new, forbidden privilege. */
const AI_JOBS_UPDATE_COLUMNS = Object.freeze([
  "status",
  "provider",
  "model",
  "tokens_input",
  "tokens_output",
  "fallback_provider",
  "output_reference",
  "error",
  "error_category",
  "completed_at",
]);

const TABLES = Object.freeze(["prompter_ai_jobs", "prompter_subscriptions", "prompter_plan_entitlements"]);
const RPC_SIGNATURE = "public.fn_create_ai_job_if_entitled(text,jsonb)";
const LEDGER = "supabase_migrations.schema_migrations";
const ADVISORY_KEY = "linoe:s1-migration-wrapper";
const LOCK_TIMEOUT = "3s";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS_DIR = resolve(HERE, "../../migrations");
const DEFAULT_MANIFEST_PATH = join(HERE, "manifest.json");

export class WrapperError extends Error {}
const fail = (msg) => {
  throw new WrapperError(msg);
};

const sha256Hex = (buf) => createHash("sha256").update(buf).digest("hex");
const sqlLit = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** Forbidden inside a wrapped migration: they would break the single-transaction guarantee or switch identity. */
const FORBIDDEN_LINES = [
  [/^\s*begin\s*(;|\s+(work|transaction)\b)/im, "BEGIN (transaction control)"],
  [/^\s*(start\s+transaction|commit|rollback|abort|savepoint|release|prepare\s+transaction)\b/im, "transaction control"],
  [/^\s*\\/m, "psql meta-command"],
  [/^\s*(set\s+(session\s+authorization|role)|reset\s+(role|session\s+authorization))\b/im, "role switching"],
];

export function loadManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    return fail(`manifest unreadable: ${e.message}`);
  }
  const files = manifest && manifest.files;
  if (!files || typeof files !== "object") return fail("manifest has no files map");
  const want = ALLOWLIST.map((m) => m.version).sort();
  const have = Object.keys(files).sort();
  if (JSON.stringify(want) !== JSON.stringify(have)) {
    return fail(`manifest versions ${JSON.stringify(have)} != allowlist ${JSON.stringify(want)}`);
  }
  for (const m of ALLOWLIST) {
    const e = files[m.version];
    if (!e || e.file !== m.file) return fail(`manifest file name for ${m.version} != ${m.file}`);
    if (!/^[0-9a-f]{64}$/.test(e.sha256 || "")) return fail(`manifest sha256 for ${m.version} is malformed`);
    if (!Number.isInteger(e.bytes) || e.bytes <= 0) return fail(`manifest bytes for ${m.version} is malformed`);
  }
  return manifest;
}

/** Reads the one allowlisted file for `version` and proves it is exactly the locked source. Returns its text. */
export function readLockedSource(version, { migrationsDir = DEFAULT_MIGRATIONS_DIR, manifest } = {}) {
  const entry = ALLOWLIST.find((m) => m.version === version);
  if (typeof version !== "string" || !entry) {
    return fail(`version ${JSON.stringify(version)} is not allowed; allowed: ${ALLOWLIST.map((m) => m.version).join(", ")}`);
  }
  const man = manifest ?? loadManifest();
  const locked = man.files[version];

  // Exactly one file may carry this version prefix (no shadow/duplicate files), and it must be the expected name.
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
  for (const [re, label] of FORBIDDEN_LINES) {
    if (re.test(text)) return fail(`${entry.file} contains forbidden ${label}`);
  }
  return { entry, text, sha256: digest };
}

// ---- SQL building blocks (all values below are constants of this file or derived from the locked checksum) -----

const tableList = TABLES.map(sqlLit).join(", ");
const roleName = `CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END`;
/** One text row per table-level and column-level ACL entry of the three S1 tables. */
const ACL_ROWS = `SELECT c.relname || '|' || ${roleName} || '|' || a.privilege_type || '|' AS r
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
           LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
      WHERE n.nspname = 'public' AND c.relname IN (${tableList})
      UNION ALL
      SELECT c.relname || '|' || ${roleName} || '|' || a.privilege_type || '|' || att.attname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute att ON att.attrelid = c.oid AND att.attnum > 0 AND NOT att.attisdropped,
           LATERAL aclexplode(att.attacl) a
      WHERE n.nspname = 'public' AND c.relname IN (${tableList}) AND att.attacl IS NOT NULL`;

const rpcMd5 = `COALESCE(md5(pg_get_functiondef(to_regprocedure(${sqlLit(RPC_SIGNATURE)}))), 'absent')`;

function markerFor(entry, sha) {
  return `s1-wrap:${entry.version}:${sha.slice(0, 12)}`;
}

function precheckBlock(entry, idx, marker) {
  const earlier = ALLOWLIST.slice(0, idx).map((m) => m.version);
  const later = ALLOWLIST.slice(idx + 1).map((m) => m.version);
  const arr = (a) => (a.length ? `ARRAY[${a.map(sqlLit).join(",")}]::text[]` : "ARRAY[]::text[]");
  return `DO $s1pre$
BEGIN
  IF to_regclass(${sqlLit(LEDGER)}) IS NULL THEN
    RAISE EXCEPTION 'STOP[ledger-missing]: ${LEDGER} not found';
  END IF;
  -- serialise concurrent runs of this wrapper (released automatically at COMMIT/ROLLBACK)
  PERFORM pg_advisory_xact_lock(hashtextextended(${sqlLit(ADVISORY_KEY)}, 0));
  PERFORM set_config('s1.wrap', ${sqlLit(marker)}, true);
  IF EXISTS (SELECT 1 FROM ${LEDGER} WHERE version = ${sqlLit(entry.version)}) THEN
    RAISE EXCEPTION 'STOP[already-recorded]: ${entry.version} is already in the ledger; nothing was executed';
  END IF;
  IF EXISTS (SELECT 1 FROM ${LEDGER} WHERE name = ${sqlLit(entry.name)}) THEN
    RAISE EXCEPTION 'STOP[name-recorded]: a ledger row named ${entry.name} already exists under another version';
  END IF;
  IF (SELECT count(*) FROM ${LEDGER} WHERE version = ANY(${arr(earlier)})) <> ${earlier.length} THEN
    RAISE EXCEPTION 'STOP[prerequisite-missing]: earlier S1 versions ${earlier.join(",") || "(none)"} are not all recorded';
  END IF;
  IF EXISTS (SELECT 1 FROM ${LEDGER} WHERE version = ANY(${arr(later)})) THEN
    RAISE EXCEPTION 'STOP[later-recorded]: a later S1 version is already recorded (wrong order)';
  END IF;
  IF ${TABLES.map((t) => `to_regclass('public.${t}') IS NULL`).join(" OR ")} THEN
    RAISE EXCEPTION 'STOP[tables-missing]: an S1 target table does not exist';
  END IF;
  PERFORM set_config('s1.acl_before', COALESCE((SELECT string_agg(r, E'\\n' ORDER BY r) FROM (${ACL_ROWS}) q(r)), ''), true);
  PERFORM set_config('s1.rpc_before', ${rpcMd5}, true);
END
$s1pre$;`;
}

const markerAssert = (marker) => `IF current_setting('s1.wrap', true) IS DISTINCT FROM ${sqlLit(marker)} THEN
    RAISE EXCEPTION 'STOP[not-single-transaction]: statements are not running inside one transaction; aborting';
  END IF;`;

function versionChecks(entry) {
  const priv = (table, roles, privs) => `
  SELECT string_agg(r || '.' || p, ',') INTO bad
  FROM unnest(ARRAY[${roles.map(sqlLit).join(",")}]) r, unnest(ARRAY[${privs.map(sqlLit).join(",")}]) p
  WHERE has_table_privilege(r, ${sqlLit(`public.${table}`)}, p);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'STOP[privilege]: ${table} still grants %', bad; END IF;`;

  if (entry.version === "20261019100000") {
    const cols = [...AI_JOBS_UPDATE_COLUMNS].sort().join(",");
    return `${priv("prompter_ai_jobs", ["anon", "authenticated"], ["INSERT", "UPDATE", "DELETE", "TRUNCATE"])}
  SELECT string_agg(a.attname, ',' ORDER BY a.attname) INTO have
  FROM pg_attribute a
  WHERE a.attrelid = 'public.prompter_ai_jobs'::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND has_column_privilege('authenticated', 'public.prompter_ai_jobs'::regclass, a.attnum, 'UPDATE');
  IF have IS DISTINCT FROM ${sqlLit(cols)} THEN
    RAISE EXCEPTION 'STOP[privilege]: authenticated column UPDATE set is [%], expected [${cols}]', have;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.prompter_ai_jobs'::regclass AND a.attnum > 0
             AND NOT a.attisdropped AND has_column_privilege('anon', 'public.prompter_ai_jobs'::regclass, a.attnum, 'UPDATE')) THEN
    RAISE EXCEPTION 'STOP[privilege]: anon has column UPDATE on prompter_ai_jobs';
  END IF;`;
  }
  if (entry.version === "20261019100100") {
    return `${priv("prompter_subscriptions", ["anon", "authenticated"], ["DELETE", "TRUNCATE"])}${priv("prompter_subscriptions", ["anon"], ["INSERT"])}
  IF (SELECT count(*) FROM pg_trigger t
      WHERE t.tgrelid = 'public.prompter_subscriptions'::regclass
        AND t.tgname = 'trg_prompter_subscriptions_enforce_trial_insert'
        AND NOT t.tgisinternal AND t.tgenabled = 'O'
        AND t.tgtype = 7 -- ROW + BEFORE + INSERT only
        AND t.tgfoid = 'public.fn_enforce_trial_subscription_insert()'::regprocedure) <> 1 THEN
    RAISE EXCEPTION 'STOP[trigger]: trial insert guard trigger is missing or has the wrong shape';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgfoid = 'public.fn_enforce_trial_subscription_insert()'::regprocedure
        AND NOT t.tgisinternal) <> 1 THEN
    RAISE EXCEPTION 'STOP[trigger]: trial insert guard function is attached to an unexpected number of triggers';
  END IF;
  IF (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.fn_enforce_trial_subscription_insert()'::regprocedure) THEN
    RAISE EXCEPTION 'STOP[trigger]: trial insert guard function must be SECURITY INVOKER';
  END IF;`;
  }
  return priv("prompter_plan_entitlements", ["anon", "authenticated"], ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]);
}

function postcheckBlock(entry, marker) {
  const allowed =
    entry.version === "20261019100000"
      ? AI_JOBS_UPDATE_COLUMNS.map((c) => sqlLit(`prompter_ai_jobs|authenticated|UPDATE|${c}`)).join(",")
      : "";
  const allowedArr = allowed ? `ARRAY[${allowed}]::text[]` : "ARRAY[]::text[]";
  return `DO $s1post$
DECLARE bad text; have text;
BEGIN
  ${markerAssert(marker)}
  -- 1) NO privilege may have been ADDED to the three tables (no anon grant, no re-granted TRUNCATE/DELETE/INSERT),
  --    except this migration's own, explicitly listed column grants.
  SELECT string_agg(r, '; ') INTO bad
  FROM (${ACL_ROWS}) q(r)
  WHERE r <> ALL (string_to_array(current_setting('s1.acl_before'), E'\\n'))
    AND r <> ALL (${allowedArr});
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'STOP[new-privilege]: privilege(s) appeared that were not there before: %', bad; END IF;
  -- 2) the RPC (PR #48 role guard) must not have been redefined
  IF ${rpcMd5} IS DISTINCT FROM current_setting('s1.rpc_before') THEN
    RAISE EXCEPTION 'STOP[rpc-changed]: fn_create_ai_job_if_entitled changed during an S1 migration';
  END IF;
  -- 3) expected end state of THIS migration${versionChecks(entry)}
END
$s1post$;`;
}

function ledgerInsert(entry, sha, text) {
  const tag = `$s1led_${sha.slice(0, 12)}$`;
  if (text.includes(tag)) fail("dollar-quote tag collision in migration text");
  return `INSERT INTO ${LEDGER} (version, name, statements)
VALUES (${sqlLit(entry.version)}, ${sqlLit(entry.name)}, ARRAY[${tag}${text}${tag}]::text[]);`;
}

function ledgerVerifyBlock(entry, idx, sha, marker) {
  const expected = ALLOWLIST.slice(0, idx + 1).map((m) => m.version).sort().join(",");
  const all = ALLOWLIST.map((m) => sqlLit(m.version)).join(",");
  return `DO $s1led$
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
    RAISE EXCEPTION 'STOP[ledger-verify]: S1 versions in ledger are [%], expected [${expected}]', have;
  END IF;
END
$s1led$;`;
}

/** Builds the complete wrapper SQL for one allowlisted version. Pure: reads files, returns a string. */
export function buildWrapper(version, opts = {}) {
  const { entry, text, sha256 } = readLockedSource(version, opts);
  const idx = ALLOWLIST.findIndex((m) => m.version === entry.version);
  const marker = markerFor(entry, sha256);
  for (const tag of ["$s1pre$", "$s1chk$", "$s1post$", "$s1led$", "$s1led_"]) {
    if (text.includes(tag)) fail(`migration text contains reserved tag ${tag}`);
  }
  const body = text.endsWith("\n") ? text : `${text}\n`;
  return `-- ===========================================================================================================
-- LINOE S1 migration wrapper (generator v${GENERATOR_VERSION}) - version ${entry.version} - ${entry.file}
-- source sha256 ${sha256}
-- ONE transaction: precheck -> migration -> privilege/state verification -> ledger INSERT -> ledger verification.
-- Send this ENTIRE text as ONE query (execute_sql / psql -c / SQL editor). Do NOT split it and do NOT add
-- BEGIN/COMMIT. If anything raises, nothing is applied and nothing is recorded. Review before use; the
-- migration text between the MIGRATION markers is the repository file, byte for byte.
-- ===========================================================================================================
SET LOCAL lock_timeout = '${LOCK_TIMEOUT}';
${precheckBlock(entry, idx, marker)}
DO $s1chk$
BEGIN
  ${markerAssert(marker)}
END
$s1chk$;
-- S1-WRAPPER: MIGRATION BEGIN ${entry.file}
${body}-- S1-WRAPPER: MIGRATION END ${entry.file}
${postcheckBlock(entry, marker)}
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
      io.out("manifest verified: all 3 files match the locked checksums\n");
      return 0;
    }
    if (cmd === "checksums" && rest.length === 0) {
      // Review aid only: prints what the files hash to NOW. It never writes the manifest.
      for (const m of ALLOWLIST) {
        const buf = readFileSync(join(DEFAULT_MIGRATIONS_DIR, m.file));
        io.out(`${m.version}  ${sha256Hex(buf)}  ${buf.length}  ${m.file}\n`);
      }
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
        const guardDir = DEFAULT_MIGRATIONS_DIR + sep;
        if (target.startsWith(guardDir) || existsSync(target)) {
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
