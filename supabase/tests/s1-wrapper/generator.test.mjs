// Unit tests for the S1 wrapper generator. Plain `node --test` (no npm dependencies, no database).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ALLOWLIST, WrapperError, buildWrapper, loadManifest, main, readLockedSource } from "../../tools/s1-wrapper/generate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(HERE, "../../migrations");
const MANIFEST = resolve(HERE, "../../tools/s1-wrapper/manifest.json");
const V = ALLOWLIST.map((m) => m.version);
const sha = (b) => createHash("sha256").update(b).digest("hex");

/** Copy of the three real files + a manifest the test may edit. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "s1w-"));
  const migrationsDir = join(dir, "migrations");
  mkdirSync(migrationsDir);
  for (const m of ALLOWLIST) cpSync(join(MIGRATIONS, m.file), join(migrationsDir, m.file));
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  return { dir, migrationsDir, manifest };
}
const relock = (fx, version) => {
  const m = ALLOWLIST.find((x) => x.version === version);
  const b = readFileSync(join(fx.migrationsDir, m.file));
  fx.manifest.files[version].sha256 = sha(b);
  fx.manifest.files[version].bytes = b.length;
};
const capture = (argv) => {
  let out = "", err = "";
  const rc = main(argv, { out: (s) => (out += s), err: (s) => (err += s) });
  return { rc, out, err };
};

test("allowlist is exactly the three S1 versions, in order", () => {
  assert.deepEqual(V, ["20261019100000", "20261019100100", "20261019100200"]);
});

test("the committed manifest matches the repository files", () => {
  const manifest = loadManifest();
  for (const m of ALLOWLIST) {
    const b = readFileSync(join(MIGRATIONS, m.file));
    assert.equal(manifest.files[m.version].sha256, sha(b), m.file);
    assert.equal(manifest.files[m.version].bytes, b.length, m.file);
  }
  assert.match(manifest.lockedAtCommit, /^[0-9a-f]{40}$/);
});

test("refuses anything outside the allowlist", () => {
  for (const bad of ["20261018160000", "20261019100300", "20261021120000", "../../etc/passwd", "", "*", "all", " 20261019100000", undefined, null, 20261019100000]) {
    assert.throws(() => buildWrapper(bad), WrapperError, String(bad));
  }
});

test("CLI refuses unknown commands/flags and prints no SQL on refusal", () => {
  for (const argv of [[], ["generate"], ["generate", "all"], ["generate", V[0], "--sql", "select 1"], ["generate", V[0], "extra"], ["apply"], ["list", "x"]]) {
    const r = capture(argv);
    assert.notEqual(r.rc, 0, JSON.stringify(argv));
    assert.equal(r.out, "", JSON.stringify(argv));
  }
});

test("CLI --out refuses supabase/migrations and existing files", () => {
  assert.equal(capture(["generate", V[0], "--out", join(MIGRATIONS, "zz_new.sql")]).rc, 1);
  assert.equal(capture(["generate", V[0], "--out", MANIFEST]).rc, 1);
});

test("a changed byte is refused (checksum + size)", () => {
  const fx = fixture();
  const f = join(fx.migrationsDir, ALLOWLIST[1].file);
  writeFileSync(f, readFileSync(f, "utf8").replace("14 days", "15 days"));
  assert.throws(() => readLockedSource(V[1], fx), /sha256|size/);
});

test("a duplicate or shadow file for the same version is refused", () => {
  const fx = fixture();
  writeFileSync(join(fx.migrationsDir, `${V[0]}_shadow.sql`), "select 1;\n");
  assert.throws(() => readLockedSource(V[0], fx), /expected exactly/);
});

test("a missing file is refused", () => {
  const fx = fixture();
  writeFileSync(join(fx.migrationsDir, ALLOWLIST[2].file), "");
  assert.throws(() => readLockedSource(V[2], fx), WrapperError);
});

test("manifest with an extra, missing or renamed entry is refused", () => {
  const fx = fixture();
  const extra = structuredClone(fx.manifest);
  extra.files["20261019100300"] = { file: "x.sql", sha256: "0".repeat(64), bytes: 1 };
  const missing = structuredClone(fx.manifest);
  delete missing.files[V[2]];
  const renamed = structuredClone(fx.manifest);
  renamed.files[V[0]].file = "20261019100000_other.sql";
  for (const [label, m] of Object.entries({ extra, missing, renamed })) {
    const p = join(fx.dir, `${label}.json`);
    writeFileSync(p, JSON.stringify(m));
    assert.throws(() => loadManifest(p), WrapperError, label);
  }
});

test("transaction control / psql meta-commands / role switching inside a migration are refused even if the manifest is re-locked", () => {
  for (const injected of ["begin;", "BEGIN TRANSACTION;", "commit;", "rollback;", "start transaction;", "savepoint a;", "\\c other", "set role postgres;", "reset role;"]) {
    const fx = fixture();
    const f = join(fx.migrationsDir, ALLOWLIST[2].file);
    writeFileSync(f, `${injected}\n${readFileSync(f, "utf8")}`);
    relock(fx, V[2]);
    assert.throws(() => buildWrapper(V[2], fx), /forbidden/, injected);
  }
});

test("a migration containing a reserved dollar-quote tag is refused", () => {
  const fx = fixture();
  const f = join(fx.migrationsDir, ALLOWLIST[2].file);
  writeFileSync(f, `${readFileSync(f, "utf8")}\n-- $s1led$\n`);
  relock(fx, V[2]);
  assert.throws(() => buildWrapper(V[2], fx), /reserved tag/);
});

test("wrapper embeds the exact file bytes twice (execution + ledger) and is deterministic", () => {
  for (const m of ALLOWLIST) {
    const text = readFileSync(join(MIGRATIONS, m.file), "utf8");
    const a = buildWrapper(m.version);
    const b = buildWrapper(m.version);
    assert.equal(a, b, "deterministic");
    assert.equal(a.split(text).length - 1, 2, `${m.file}: file text appears exactly twice`);
    assert.ok(a.includes(`source sha256 ${sha(Buffer.from(text))}`));
  }
});

test("wrapper structure: precheck -> single-txn proof -> migration -> verification -> ledger insert -> ledger verification", () => {
  for (const m of ALLOWLIST) {
    const w = buildWrapper(m.version);
    const order = ["SET LOCAL lock_timeout", "$s1pre$", "$s1chk$", "MIGRATION BEGIN", "MIGRATION END", "$s1post$", "INSERT INTO supabase_migrations.schema_migrations", "$s1led$"];
    let at = -1;
    for (const marker of order) {
      const i = w.indexOf(marker, at + 1);
      assert.ok(i > at, `${m.version}: ${marker} out of order`);
      at = i;
    }
    // exactly one ledger INSERT, with the explicit version, and no transaction control of its own
    assert.equal((w.match(/INSERT INTO supabase_migrations\.schema_migrations/g) || []).length, 1);
    assert.ok(w.includes(`VALUES ('${m.version}', '${m.name}'`));
    const outsideMigration = w.replace(/-- S1-WRAPPER: MIGRATION BEGIN[\s\S]*?-- S1-WRAPPER: MIGRATION END[^\n]*\n/, "");
    assert.doesNotMatch(outsideMigration, /^\s*(begin\s*;|begin\s+(work|transaction)\b|commit\b|rollback\b|start\s+transaction\b)/im);
    assert.doesNotMatch(w, /\bgrant\b[^\n]*\bto\b[^\n]*\banon\b/i, `${m.version}: no GRANT to anon anywhere`);
  }
});

test("each wrapper requires all earlier S1 versions and forbids later ones", () => {
  const w2 = buildWrapper(V[1]);
  assert.ok(w2.includes(`ARRAY['${V[0]}']::text[]`) && w2.includes(`ARRAY['${V[2]}']::text[]`));
  const w3 = buildWrapper(V[2]);
  assert.ok(w3.includes(`ARRAY['${V[0]}','${V[1]}']::text[]`));
  const w1 = buildWrapper(V[0]);
  assert.ok(w1.includes("ARRAY[]::text[]"));
});
