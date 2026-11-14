#!/usr/bin/env node
// QA-2: penerap bundel skema ke proyek Supabase QA (ref di qa-project-allowlist.mjs) lewat `psql`.
//
// Node murni, tanpa dependensi. Dipanggil HANYA oleh .github/workflows/qa-schema-apply.yml (manual, Environment qa-real-email).
// Mode (env QA_APPLY_MODE atau --mode):
//   check     BACA-SAJA: current_database(), jumlah tabel public, penanda sandbox, jumlah auth.users. Tidak menulis apa pun.
//   apply     wajib QA_APPLY_CONFIRM == "APPROVE QA-2-SCHEMA-BUNDLE" (persis). Menjalankan `check` dulu; hanya bila proyek KOSONG
//             (atau terpasang sebagian dari bundel ini) lalu bagian 1,2,3 berurutan, berhenti di galat pertama, lalu verifikasi akhir.
//   rls-test  qa/qa2-rls-cross-tenant.sql (sengaja berakhir galat QA2_RLS_RESULT); hanya bila skema sudah terpasang + terverifikasi.
// Kode keluar: 0 sukses | 1 gagal verifikasi/eksekusi | 2 ditolak guard (sebelum/tanpa koneksi atau proyek tidak dikenal).
// TIDAK ada fungsi drop/reset/truncate proyek. Tidak pernah mencetak URL/password.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { APPROVAL_PHRASE, REAL_REFS, buildBundle, loadManifest } from "./build-schema-bundle.mjs";
import { ALLOWED_QA_PROJECT_REFS } from "./qa-project-allowlist.mjs";

export { APPROVAL_PHRASE };
export const MODES = Object.freeze(["check", "apply", "rls-test"]);
export const EXIT = Object.freeze({ OK: 0, FAIL: 1, REFUSED: 2 });
export const PARTS = 3;
export const RLS_FILE = "qa/qa2-rls-cross-tenant.sql";

/** Variabel env yang menunjuk produksi/akses luas atau bisa membelokkan psql. Ada salah satu = ditolak (fail-closed). */
export const FORBIDDEN_ENV_NAMES = Object.freeze([
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_DB_URL",
  "SUPABASE_URL",
  "SUPABASE_PROJECT_REF",
  "NEXT_PUBLIC_SUPABASE_URL",
  "DATABASE_URL",
  "DIRECT_URL",
  "DIRECT_DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_HOST",
  "POSTGRES_PASSWORD",
  "PSQLRC",
  "SERVICE_ROLE_KEY",
]);
/** Awalan terlarang: semua PG* (PGHOST, PGUSER, PGDATABASE, PGSERVICE, PGOPTIONS, PGPASSFILE, PGSSL*, ...), SUPABASE_*, QA_SUPABASE_*. */
export const FORBIDDEN_ENV_PREFIXES = Object.freeze(["PG", "SUPABASE_", "NEXT_PUBLIC_SUPABASE", "QA_SUPABASE_"]);

const DIRECT_HOST = (ref) => `db.${ref}.supabase.co`;
const POOLER_HOST_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.pooler\.supabase\.com$/;

export class GuardError extends Error {
  constructor(message) {
    super(message);
    this.name = "GuardError";
  }
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** Daftar nilai rahasia yang harus disamarkan di semua keluaran. */
export function secretsOf(raw, conn) {
  const out = new Set();
  const add = (v) => {
    if (typeof v === "string" && v.length >= 1) out.add(v);
  };
  add(raw);
  if (conn) {
    add(conn.password);
    add(encodeURIComponent(conn.password));
    add(encodeURI(conn.password));
  }
  return [...out].sort((a, b) => b.length - a.length);
}

export function redact(text, secrets) {
  let out = String(text ?? "");
  for (const s of secrets ?? []) if (s) out = out.split(s).join("[REDACTED]");
  return out;
}

/** Tolak env berbahaya. Mengembalikan daftar NAMA variabel (bukan nilai) yang bermasalah. */
export function forbiddenEnvNames(env) {
  const bad = [];
  for (const [k, v] of Object.entries(env ?? {})) {
    if (v === undefined || v === "") continue;
    if (FORBIDDEN_ENV_NAMES.includes(k) || FORBIDDEN_ENV_PREFIXES.some((p) => k.startsWith(p))) bad.push(k);
  }
  return bad.sort();
}

/**
 * Validasi QA_DB_URL. Hanya dua bentuk persis:
 *   postgres(ql)://postgres:<pw>@db.<ref>.supabase.co:5432/postgres
 *   postgres(ql)://postgres.<ref>:<pw>@<region>.pooler.supabase.com:5432/postgres
 * `ref` berasal HANYA dari ALLOWED_QA_PROJECT_REFS. Pesan galat tidak pernah memuat URL.
 */
export function parseQaDbUrl(raw, { allowedRefs = ALLOWED_QA_PROJECT_REFS, realRefs = REAL_REFS } = {}) {
  const fail = (why) => {
    throw new GuardError(`QA_DB_URL ditolak: ${why}`);
  };
  if (typeof raw !== "string" || raw.trim() === "") fail("kosong atau bukan teks");
  if (raw !== raw.trim() || /[\s\u0000-\u001f]/.test(raw)) fail("mengandung spasi/karakter kontrol");
  const lower = raw.toLowerCase();
  if (realRefs.some((r) => lower.includes(r))) fail("memuat ref proyek nyata/bersama (dilarang)");
  if (!/^postgres(?:ql)?:\/\//i.test(raw)) fail("skema harus postgres atau postgresql");
  let u;
  try {
    u = new URL(raw);
  } catch {
    return fail("bukan URL valid (karakter khusus di password harus di-URL-encode)");
  }
  if (u.hash) fail("fragmen tidak diizinkan");
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") fail("skema tidak diizinkan");
  let user;
  let password;
  try {
    user = decodeURIComponent(u.username);
    password = decodeURIComponent(u.password);
  } catch {
    return fail("encoding user/password tidak valid");
  }
  if (!password) fail("password tidak ada");
  if (/[\r\n\0]/.test(password) || /[\r\n\0]/.test(user)) fail("karakter kontrol di user/password");
  const host = u.hostname.toLowerCase();
  if (u.port !== "" && u.port !== "5432") fail("port harus 5432 (mode session/direct)");
  const dbName = u.pathname === "" || u.pathname === "/" ? "postgres" : decodeURIComponent(u.pathname.slice(1));
  if (dbName !== "postgres") fail("nama database harus postgres");
  if (u.pathname.slice(1).includes("/")) fail("path tidak valid");

  // Query: hanya sslmode=require.
  const keys = [...u.searchParams.keys()];
  for (const k of keys) {
    if (k !== "sslmode") fail(`parameter query tidak diizinkan (${k.slice(0, 20)})`);
  }
  if (u.searchParams.getAll("sslmode").some((v) => v !== "require")) fail("sslmode hanya boleh require");
  if (keys.length > 1) fail("parameter query ganda");

  let ref = null;
  let form = null;
  for (const allowed of allowedRefs) {
    if (!/^[a-z0-9]{20}$/.test(allowed)) continue;
    if (host === DIRECT_HOST(allowed) && user === "postgres") {
      ref = allowed;
      form = "direct";
    } else if (POOLER_HOST_RE.test(host) && user === `postgres.${allowed}`) {
      ref = allowed;
      form = "pooler";
    }
  }
  if (!ref) fail("host/user bukan salah satu dari dua bentuk yang diizinkan untuk proyek QA");
  return { host, port: "5432", user, password, database: "postgres", ref, form };
}

/** Env proses psql dibangun dari nol. */
export function buildChildEnv(conn, parentEnv = {}) {
  return {
    PATH: parentEnv.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    PGPASSWORD: conn.password,
    PGHOST: conn.host,
    PGPORT: conn.port,
    PGUSER: conn.user,
    PGDATABASE: conn.database,
    PGSSLMODE: "require",
    PGCONNECT_TIMEOUT: "20",
    PGAPPNAME: "qa2-schema-apply",
  };
}

/** Argumen psql tetap. Tanpa -c dan tanpa input pengguna; SQL dikirim lewat stdin. */
export const PSQL_ARGS = Object.freeze(["-X", "-v", "ON_ERROR_STOP=1", "--no-password", "-q", "-A", "-t", "-F", "|", "-f", "-"]);

const WRITE_WORDS = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do|begin|commit|rollback|set|reset|vacuum|lock|notify|execute)\b/i;
/** Kueri baca-saja tetap. Semua SQL `check` harus lolos assertReadOnly. */
export const Q_STATE =
  "select current_database(), " +
  "(select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'), " +
  "(to_regclass('public._linoe_sandbox_marker') is not null), " +
  "(to_regclass('public._linoe_sandbox_applied') is not null), " +
  "(select count(*) from auth.users);";
export const Q_MARKER = "select count(*) from public._linoe_sandbox_marker where id = 1 and purpose like 'QA2_SANDBOX_ONLY%';";
export const Q_APPLIED = "select version || ':' || sha256 from public._linoe_sandbox_applied order by version;";
// Salinan verifikasi akhir bagian 3 bundel (dijaga tes agar sama dengan akhir bundel).
export const Q_VERIFY =
  "select " +
  "(select count(*) from public._linoe_sandbox_applied), " +
  "(select tgenabled from pg_trigger where tgname = 'trg_prompter_subscriptions_enforce_trial_insert'), " +
  "(select count(*) from public.prompter_plan_entitlements where plan = 'FREE' and availability = 'ACTIVE'), " +
  "(select count(*) from pg_trigger where tgname = 'qa_on_auth_user_created'), " +
  "(select count(*) from pg_policies where schemaname = 'public' and tablename in ('tenants', 'user_profiles')), " +
  "(has_table_privilege('authenticated', 'public.tenants', 'select') " +
  "and has_table_privilege('authenticated', 'public.user_profiles', 'select') " +
  "and has_function_privilege('authenticated', 'public.fn_current_tenant_id()', 'execute') " +
  "and has_function_privilege('authenticated', 'public.fn_current_role()', 'execute')), " +
  "(has_table_privilege('service_role', 'public.tenants', 'select') " +
  "and has_table_privilege('service_role', 'public.user_profiles', 'select') " +
  "and has_table_privilege('service_role', 'public.prompter_subscriptions', 'select')), " +
  "(has_table_privilege('authenticated', 'public.prompter_brand_profiles', 'insert') " +
  "and has_table_privilege('authenticated', 'public.prompter_audit_logs', 'insert') " +
  "and has_table_privilege('authenticated', 'public.prompter_subscriptions', 'insert') " +
  "and has_table_privilege('authenticated', 'public.prompter_subscriptions', 'select') " +
  "and has_table_privilege('authenticated', 'public.prompter_analytics_insights', 'select')), " +
  "(select count(*) from pg_trigger where tgname = 'qa2_before_auth_user_delete');";

export function assertReadOnly(sql) {
  const s = sql.trim();
  if (!/^select\s/i.test(s) || s.indexOf(";") !== s.length - 1 || WRITE_WORDS.test(s.replace(/'[^']*'/g, "''"))) {
    throw new GuardError("kueri bukan baca-saja (ditolak)");
  }
}

/** Indikator verifikasi akhir: [nama, nilai diharapkan]. */
export function expectedIndicators(migrationCount) {
  return [
    ["migrations_applied", String(migrationCount)],
    ["trial_trigger", "O"],
    ["free_plan_active", "1"],
    ["signup_trigger", "1"],
    ["shim_policies", "3"],
    ["authenticated_access", "t"],
    ["service_role_access", "t"],
    ["app_table_grants", "t"],
    ["reset_trigger", "1"],
  ];
}

export function evaluateVerify(line, migrationCount) {
  const cells = String(line ?? "").trim().split("|");
  const exp = expectedIndicators(migrationCount);
  const rows = exp.map(([name, want], i) => ({ name, want, got: cells[i] ?? "(kosong)", ok: cells.length === exp.length && cells[i] === want }));
  return { pass: rows.every((r) => r.ok), rows };
}

/** Pembangun bagian dari repo: mengembalikan [{text, sha256, versions:[{version, sha256}]}] dan jumlah migrasi. */
export function buildParts(root) {
  const manifest = loadManifest(root);
  const b = buildBundle({ root, manifest, parts: PARTS });
  const parts = b.parts.map((text) => {
    if (/^\s*\\/m.test(text)) throw new GuardError("bagian bundel memuat meta-command psql (ditolak)");
    const versions = [...text.matchAll(/\('(\d{14})', '([0-9a-f]{64})'\)/g)].map((m) => ({ version: m[1], sha256: m[2] }));
    return { text, sha256: sha256(text), bytes: Buffer.byteLength(text, "utf8"), versions };
  });
  if (parts.length !== PARTS || parts.some((p) => p.versions.length === 0)) throw new GuardError("bundel tidak berbentuk 3 bagian bermigrasi");
  const total = parts.reduce((n, p) => n + p.versions.length, 0);
  if (total !== b.migrations.length) throw new GuardError("jumlah versi pelacak tidak sama dengan jumlah migrasi");
  return { parts, migrationCount: b.migrations.length };
}

function defaultSpawn(cmd, args, { env, input, timeoutMs }) {
  const r = spawnSync(cmd, args, { env, input, encoding: "utf8", timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? "", stderr: (r.stderr ?? "") + (r.error ? `\n${r.error.message}` : ""), signal: r.signal };
}

/** Menjalankan satu operasi apply/check/rls-test. Semua dependensi dapat disuntik (tes). */
export async function runApply(deps = {}) {
  const env = deps.env ?? process.env;
  const spawn = deps.spawn ?? defaultSpawn;
  const root = deps.root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const readFile = deps.readFile ?? ((p) => readFileSync(p, "utf8"));
  const makeParts = deps.buildParts ?? buildParts;
  const allowedRefs = deps.allowedRefs ?? ALLOWED_QA_PROJECT_REFS;
  let secrets = [];
  const lines = [];
  const emit = (msg) => {
    const safe = redact(msg, secrets);
    lines.push(safe);
    (deps.log ?? ((m) => console.log(m)))(safe);
  };
  const finish = (code, verdict, extra = []) => {
    const summary = [`## QA-2 schema apply: ${verdict}`, "", ...extra.map((e) => redact(e, secrets)), "", `Kode keluar: ${code}`].join("\n");
    try {
      (deps.writeSummary ?? ((t) => env.GITHUB_STEP_SUMMARY && appendFileSync(env.GITHUB_STEP_SUMMARY, `${t}\n`)))(summary);
    } catch {
      /* ringkasan best-effort */
    }
    return { exitCode: code, verdict, lines };
  };
  const refuse = (why) => {
    emit(`REFUSED: ${why}`);
    return finish(EXIT.REFUSED, "DITOLAK guard", [`- ${why}`, "- Tidak ada koneksi database dibuat."]);
  };

  // ---- guard SEBELUM koneksi ----
  const mode = String(env.QA_APPLY_MODE ?? deps.mode ?? "");
  if (!MODES.includes(mode)) return refuse(`mode tidak dikenal (harus salah satu: ${MODES.join(", ")})`);
  if (mode === "apply" && env.QA_APPLY_CONFIRM !== APPROVAL_PHRASE) return refuse("mode apply butuh frasa konfirmasi persis (tidak cocok)");
  const badEnv = forbiddenEnvNames(env);
  if (badEnv.length) return refuse(`env proses memuat variabel terlarang: ${badEnv.join(", ")}`);
  let conn;
  try {
    conn = parseQaDbUrl(env.QA_DB_URL, { allowedRefs });
  } catch (e) {
    secrets = secretsOf(env.QA_DB_URL, null);
    return refuse(e instanceof GuardError ? e.message : "QA_DB_URL tidak valid");
  }
  secrets = secretsOf(env.QA_DB_URL, conn);

  let built;
  try {
    built = makeParts(root);
  } catch (e) {
    emit(`GAGAL membangun bundel: ${e instanceof Error ? e.message : String(e)}`);
    return finish(EXIT.FAIL, "GAGAL (bundel)", ["- Bundel tidak dapat dibangun/divalidasi dari repo."]);
  }
  const { parts, migrationCount } = built;
  emit(`Proyek QA ${conn.ref} (bentuk koneksi: ${conn.form}); mode=${mode}; migrasi=${migrationCount}`);
  parts.forEach((p, i) => emit(`BAGIAN ${i + 1}/${parts.length} sha256=${p.sha256} bytes=${p.bytes} migrasi=${p.versions.length}`));

  const childEnv = buildChildEnv(conn, env);
  const psql = (sql, { readOnly = false, timeoutMs = 120_000 } = {}) => {
    if (readOnly) assertReadOnly(sql);
    const r = spawn("psql", [...PSQL_ARGS], { env: childEnv, input: sql, timeoutMs });
    return { status: r.status, stdout: redact(r.stdout, secrets), stderr: redact(r.stderr, secrets) };
  };
  const tail = (t, n = 12) => String(t).trim().split("\n").slice(-n).join("\n");

  // ---- check (baca-saja) ----
  const inspect = () => {
    const s = psql(Q_STATE, { readOnly: true });
    if (s.status !== 0) return { state: "ERROR", detail: `koneksi/kueri gagal: ${tail(s.stderr, 4)}` };
    const [db, tables, marker, appliedTbl, users] = s.stdout.trim().split("|");
    const info = { database: db, publicTables: Number(tables), marker: marker === "t", appliedTable: appliedTbl === "t", authUsers: Number(users) };
    if (db !== "postgres" || !Number.isFinite(info.publicTables) || !Number.isFinite(info.authUsers)) return { state: "UNKNOWN", info, detail: "keluaran tidak dikenal" };
    if (!info.marker && info.publicTables === 0 && info.authUsers === 0) return { state: "EMPTY", info };
    if (!info.marker || !info.appliedTable) return { state: "UNKNOWN", info, detail: "proyek tidak kosong dan tidak ada penanda sandbox QA-2" };
    const m = psql(Q_MARKER, { readOnly: true });
    if (m.status !== 0 || m.stdout.trim() !== "1") return { state: "UNKNOWN", info, detail: "penanda sandbox bukan QA2_SANDBOX_ONLY" };
    const a = psql(Q_APPLIED, { readOnly: true });
    if (a.status !== 0) return { state: "UNKNOWN", info, detail: "pelacak versi tidak terbaca" };
    const applied = a.stdout.trim() === "" ? [] : a.stdout.trim().split("\n").map((x) => x.trim());
    const expectedAll = parts.flatMap((p) => p.versions.map((v) => `${v.version}:${v.sha256}`));
    let k = 0;
    let n = 0;
    for (const p of parts) {
      const mine = p.versions.map((v) => `${v.version}:${v.sha256}`);
      if (applied.slice(n, n + mine.length).join(",") === mine.join(",")) {
        k += 1;
        n += mine.length;
      } else break;
    }
    if (n !== applied.length || k === 0) return { state: "UNKNOWN", info, applied: applied.length, detail: "versi/sha256 terpasang tidak cocok dengan bundel repo" };
    info.appliedMigrations = applied.length;
    if (k < parts.length) return { state: "PARTIAL", info, partsApplied: k, detail: `${k} dari ${parts.length} bagian terpasang` };
    if (applied.length !== expectedAll.length) return { state: "UNKNOWN", info, detail: "jumlah migrasi tidak cocok" };
    const v = psql(Q_VERIFY, { readOnly: true });
    if (v.status !== 0) return { state: "UNKNOWN", info, detail: `verifikasi tidak dapat dijalankan: ${tail(v.stderr, 3)}` };
    const ev = evaluateVerify(v.stdout, migrationCount);
    if (!ev.pass) return { state: "UNKNOWN", info, verify: ev, detail: "bagian 1-3 terpasang tetapi verifikasi gagal" };
    return { state: "INSTALLED_VERIFIED", info, verify: ev };
  };

  const report = (r) => {
    emit(`STATUS PROYEK: ${r.state}${r.detail ? ` (${r.detail})` : ""}`);
    if (r.info) emit(`  database=${r.info.database} tabel_public=${r.info.publicTables} penanda=${r.info.marker} auth_users=${r.info.authUsers}`);
    return [`- Status proyek: **${r.state}**${r.detail ? ` (${r.detail})` : ""}`, ...(r.info ? [`- Tabel public: ${r.info.publicTables}; auth.users: ${r.info.authUsers}; penanda sandbox: ${r.info.marker}`] : [])];
  };
  const indicatorLines = (ev) => ev.rows.map((x) => `  - ${x.name}: ${x.got} (harapan ${x.want}) ${x.ok ? "OK" : "SALAH"}`);

  const before = inspect();
  const beforeSummary = report(before);
  if (before.state === "ERROR") return finish(EXIT.FAIL, "GAGAL terhubung/membaca", beforeSummary);

  if (mode === "check") {
    if (before.state === "INSTALLED_VERIFIED") {
      emit("CHECK: sudah terpasang dan terverifikasi (tidak ada yang ditulis).");
      return finish(EXIT.OK, "CHECK: sudah terpasang", [...beforeSummary, ...indicatorLines(before.verify)]);
    }
    if (before.state === "EMPTY") {
      emit("CHECK: proyek kosong, siap untuk mode apply.");
      return finish(EXIT.OK, "CHECK: kosong (siap apply)", beforeSummary);
    }
    emit(`CHECK: ${before.state} - tidak ada yang ditulis.`);
    return finish(EXIT.FAIL, `CHECK: ${before.state}`, beforeSummary);
  }

  if (mode === "rls-test") {
    if (before.state !== "INSTALLED_VERIFIED") return refuse(`rls-test butuh skema terpasang dan terverifikasi (status: ${before.state})`);
    const sql = readFile(path.join(root, RLS_FILE));
    if (/^\s*\\/m.test(sql)) return refuse("berkas uji RLS memuat meta-command psql");
    emit("Menjalankan uji RLS lintas tenant (transaksi sengaja dibatalkan oleh galat QA2_RLS_RESULT).");
    const r = psql(sql, { timeoutMs: 300_000 });
    const msg = (r.stderr.match(/ERROR:\s+QA2_RLS_RESULT[^\n]*/) ?? [""])[0];
    if (/ERROR:\s+QA2_RLS_RESULT ALL_PASS \| fails=0(?:\s|\||$)/.test(msg)) {
      emit(`RLS-TEST: PASS - ${msg.replace(/^ERROR:\s+/, "").slice(0, 400)}`);
      return finish(EXIT.OK, "RLS-TEST PASS", [...beforeSummary, "- Hasil: ALL_PASS | fails=0 (bukti SANDBOX-nya hanya dari proyek QA; bukan produksi)."]);
    }
    if (msg) {
      emit(`RLS-TEST: FAIL - ${msg.replace(/^ERROR:\s+/, "").slice(0, 600)}`);
      return finish(EXIT.FAIL, "RLS-TEST FAIL", [...beforeSummary, "- Ada pemeriksaan RLS yang gagal; lihat log. Tidak membatalkan apply."]);
    }
    emit(`RLS-TEST: GAGAL dieksekusi (bukan hasil RLS): ${tail(r.stderr, 6)}`);
    return finish(EXIT.FAIL, "RLS-TEST gagal dieksekusi", [
      ...beforeSummary,
      "- Galat bukan QA2_RLS_RESULT. UNKNOWN: insert minimal ke auth.users di Supabase hosted belum terbukti; kegagalan ini TIDAK membatalkan apply.",
    ]);
  }

  // ---- apply ----
  if (before.state === "INSTALLED_VERIFIED") {
    emit("ALREADY_APPLIED");
    return finish(EXIT.OK, "ALREADY_APPLIED", [...beforeSummary, ...indicatorLines(before.verify), "- Tidak ada yang ditulis."]);
  }
  if (before.state !== "EMPTY" && before.state !== "PARTIAL") {
    return refuse(`proyek tidak kosong dan belum terpasang oleh bundel ini (status: ${before.state}); apply dihentikan tanpa menulis`);
  }
  const start = before.state === "PARTIAL" ? before.partsApplied : 0;
  if (start > 0) emit(`Melanjutkan dari bagian ${start + 1} (bagian 1-${start} sudah terpasang dan cocok).`);
  const done = [];
  for (let i = start; i < parts.length; i++) {
    emit(`MENJALANKAN bagian ${i + 1}/${parts.length} (satu transaksi)...`);
    const r = psql(parts[i].text, { timeoutMs: 600_000 });
    if (r.status !== 0) {
      emit(`GAGAL di bagian ${i + 1}; berhenti (bagian berikutnya tidak dijalankan). Galat:\n${tail(r.stderr, 15)}`);
      return finish(EXIT.FAIL, `GAGAL di bagian ${i + 1}`, [
        ...beforeSummary,
        ...done,
        `- Bagian ${i + 1} gagal; tidak ada yang tersimpan dari bagian itu. Bagian berikutnya tidak dijalankan.`,
        "- Jalankan mode check lalu apply lagi (melanjutkan dari bagian yang belum terpasang) setelah penyebab dibereskan.",
      ]);
    }
    emit(`Bagian ${i + 1} selesai.`);
    done.push(`- Bagian ${i + 1}/${parts.length} diterapkan (sha256 ${parts[i].sha256.slice(0, 16)}...)`);
  }
  const v = psql(Q_VERIFY, { readOnly: true });
  const ev = v.status === 0 ? evaluateVerify(v.stdout, migrationCount) : { pass: false, rows: [] };
  if (!ev.pass) {
    emit(`VERIFIKASI: FAIL${v.status === 0 ? "" : ` (kueri gagal: ${tail(v.stderr, 3)})`}`);
    ev.rows.forEach((x) => emit(`  ${x.name}=${x.got} (harapan ${x.want}) ${x.ok ? "OK" : "SALAH"}`));
    return finish(EXIT.FAIL, "VERIFIKASI FAIL", [...beforeSummary, ...done, ...indicatorLines(ev)]);
  }
  emit("VERIFIKASI: PASS");
  ev.rows.forEach((x) => emit(`  ${x.name}=${x.got} OK`));
  return finish(EXIT.OK, "APPLY PASS", [...beforeSummary, ...done, "- Verifikasi akhir: PASS", ...indicatorLines(ev), "- Bukti ini REAL untuk skema di proyek QA; QA-2 TIDAK diaktifkan."]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf("--mode");
  const mode = i > 0 ? process.argv[i + 1] : undefined;
  runApply({ mode })
    .then((r) => process.exit(r.exitCode))
    .catch((e) => {
      console.error(`GAGAL tak terduga: ${e instanceof Error ? e.name : "error"}`);
      process.exit(EXIT.FAIL);
    });
}
