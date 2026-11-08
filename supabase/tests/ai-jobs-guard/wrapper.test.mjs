// Unit tests for the quota-guard wrapper generator. Plain `node --test` (no npm dependencies, no database).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ALLOWLIST, S1_VERSIONS, WrapperError, buildWrapper, loadManifest, main, readLockedSource, verifyAuxiliary } from "../../tools/quota-guard-wrapper/generate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = resolve(HERE, "../..");
const TOOLS = join(SUPA, "tools/quota-guard-wrapper");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const V = ALLOWLIST.map((m) => m.version);
const capture = (argv) => {
  let out = "", err = "";
  const rc = main(argv, { out: (s) => (out += s), err: (s) => (err += s) });
  return { rc, out, err };
};
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "qgw-"));
  const migrationsDir = join(dir, "migrations");
  mkdirSync(migrationsDir);
  for (const m of ALLOWLIST) cpSync(join(SUPA, "migrations", m.file), join(migrationsDir, m.file));
  return { dir, migrationsDir, manifest: JSON.parse(readFileSync(join(TOOLS, "manifest.json"), "utf8")) };
}

test("allowlist is exactly the two guard versions, in order, and S1 is the three S1 versions", () => {
  assert.deepEqual(V, ["20261021120000", "20261021120100"]);
  assert.deepEqual([...S1_VERSIONS], ["20261019100000", "20261019100100", "20261019100200"]);
});

test("the committed manifest matches the repository files (migrations, rollbacks, read-only checks)", () => {
  const manifest = loadManifest();
  for (const m of ALLOWLIST) {
    const b = readFileSync(join(SUPA, "migrations", m.file));
    assert.equal(manifest.files[m.version].sha256, sha(b), m.file);
    assert.equal(manifest.files[m.version].bytes, b.length, m.file);
  }
  assert.equal(verifyAuxiliary({ manifest }).length, 4);
  assert.match(manifest.lockedAtCommit, /^[0-9a-f]{40}$/);
});

test("the read-only SQL embeds exactly the manifest's md5 and ledger sha256 values", () => {
  const man = loadManifest();
  const pre = readFileSync(join(TOOLS, "preflight_readonly.sql"), "utf8");
  const post = readFileSync(join(TOOLS, "postflight_readonly.sql"), "utf8");
  for (const f of [pre, post]) {
    assert.ok(f.includes(man.expect.rpcMd5Before));
    assert.ok(f.includes(man.expect.rpcMd5AfterPart1));
  }
  assert.ok(post.includes(man.files[V[0]].sha256));
  assert.ok(post.includes(man.files[V[1]].sha256));
});

test("refuses anything outside the allowlist", () => {
  for (const bad of ["20261019100000", "20261021120200", "../../etc/passwd", "", "*", "all", " 20261021120000", undefined, null, 20261021120000]) {
    assert.throws(() => buildWrapper(bad), WrapperError, String(bad));
  }
});

test("a changed migration byte is refused (checksum lock)", () => {
  const fx = fixture();
  const f = join(fx.migrationsDir, ALLOWLIST[0].file);
  writeFileSync(f, readFileSync(f, "utf8") + "\n-- x\n");
  assert.throws(() => readLockedSource(V[0], fx), /size|sha256/);
});

test("a duplicate/shadow file with the same version is refused", () => {
  const fx = fixture();
  writeFileSync(join(fx.migrationsDir, `${V[0]}_other.sql`), "select 1;");
  assert.throws(() => readLockedSource(V[0], fx), /expected exactly/);
});

test("a read-only check file that writes is refused", () => {
  const fx = fixture();
  const dir = mkdtempSync(join(tmpdir(), "qgwtools-"));
  for (const k of ["preflight", "postflight"]) cpSync(join(TOOLS, `${k}_readonly.sql`), join(dir, `${k}_readonly.sql`));
  const p = join(dir, "preflight_readonly.sql");
  writeFileSync(p, readFileSync(p, "utf8") + "\n;delete from public.prompter_ai_jobs;\n");
  assert.throws(() => verifyAuxiliary({ toolsDir: dir, manifest: fx.manifest }), /sha256|not read-only/);
  // even with a re-locked hash the content lint refuses
  fx.manifest.readonly.preflight.sha256 = sha(readFileSync(p));
  assert.throws(() => verifyAuxiliary({ toolsDir: dir, manifest: fx.manifest }), /not read-only/);
});

test("generated SQL: one ledger INSERT, no transaction control, no GRANT, embeds the file byte-for-byte", () => {
  for (const m of ALLOWLIST) {
    const sql = buildWrapper(m.version);
    const src = readFileSync(join(SUPA, "migrations", m.file), "utf8");
    const begin = `-- QG-WRAPPER: MIGRATION BEGIN ${m.file}\n`;
    const end = `-- QG-WRAPPER: MIGRATION END ${m.file}\n`;
    const body = sql.slice(sql.indexOf(begin) + begin.length, sql.indexOf(end));
    assert.equal(body, src.endsWith("\n") ? src : src + "\n");
    const outside = sql.replaceAll(body.trimEnd(), "");
    assert.equal((outside.match(/INSERT INTO supabase_migrations\.schema_migrations/g) ?? []).length, 1);
    assert.doesNotMatch(outside, /^\s*begin\s*(;|\s+(work|transaction)\b)/im);
    assert.doesNotMatch(outside, /^\s*(start\s+transaction|commit|rollback|abort|savepoint)\b/im);
    assert.doesNotMatch(outside, /^\s*(grant|revoke)\s/im);
    assert.match(sql, /SET LOCAL lock_timeout/);
    assert.match(sql, /STOP\[s1-missing\]/);
    assert.match(sql, /STOP\[not-single-transaction\]/);
  }
});

test("part 2 wrapper requires part 1 first and does not allow the RPC to change", () => {
  const sql = buildWrapper(V[1]);
  assert.match(sql, /STOP\[prerequisite-missing\]/);
  assert.match(sql, /STOP\[rpc-changed\]/);
  assert.match(buildWrapper(V[0]), /STOP\[later-recorded\]/);
});

test("CLI refuses unknown commands/flags and prints no SQL on refusal", () => {
  for (const argv of [[], ["generate"], ["generate", "all"], ["generate", V[0], "--sql", "select 1"], ["generate", V[0], "extra"], ["apply"], ["list", "x"]]) {
    const r = capture(argv);
    assert.notEqual(r.rc, 0, JSON.stringify(argv));
    assert.equal(r.out, "");
  }
  const ok = capture(["verify"]);
  assert.equal(ok.rc, 0);
  assert.match(ok.out, /manifest verified/);
});

test("--out refuses supabase/migrations and existing files", () => {
  assert.equal(capture(["generate", V[0], "--out", join(SUPA, "migrations", "x.sql")]).rc, 1);
  assert.equal(capture(["generate", V[0], "--out", join(TOOLS, "manifest.json")]).rc, 1);
});
