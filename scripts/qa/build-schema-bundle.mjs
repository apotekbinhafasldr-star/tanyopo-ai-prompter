#!/usr/bin/env node
// QA-2: pembangun BUNDEL SKEMA MINIMUM untuk proyek Supabase QA (ref di manifest).
//
// Node murni, tanpa dependensi. TIDAK terhubung ke database/jaringan mana pun: hanya MEMBACA berkas di repo
// (qa/qa2-schema-manifest.json, qa/qa2-shim.sql, supabase/migrations/*.sql) dan MENULIS satu berkas teks .sql
// ke path keluaran (--out) atau ke stdout. Tidak menjalankan SQL, tidak membuka koneksi, tidak membaca env/secret.
//
//   node scripts/qa/build-schema-bundle.mjs --out /path/di/luar/repo/qa2-schema-bundle.sql
//   node scripts/qa/build-schema-bundle.mjs > bundle.sql
//   node scripts/qa/build-schema-bundle.mjs --check        # validasi saja, tanpa keluaran bundel
//   node scripts/qa/build-schema-bundle.mjs --out /path/qa2.sql --parts 2   # dibagi di batas migrasi (urutan tetap), tiap bagian atomik
//
// Fail-closed: berkas manifest hilang, urutan salah, pola terlarang, atau ref proyek nyata di luar komentar => REFUSED (exit 1).
// Penerapan bundel butuh persetujuan Founder: APPROVE QA-2-SCHEMA-BUNDLE (lihat docs/QA2_SCHEMA_MINIMUM.md).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const WARNING_LINE = "HANYA UNTUK PROYEK QA gasdqsadnjoknisloaec";
export const APPROVAL_PHRASE = "APPROVE QA-2-SCHEMA-BUNDLE";
export const MANIFEST_PATH = "qa/qa2-schema-manifest.json";
export const REDACTED = "[ref-proyek-nyata-disamarkan]";

// Ref proyek NYATA (produksi/bersama dan proyek lain milik Founder). Disusun dari potongan agar literal utuh tidak
// tertulis di sini; tidak boleh muncul di bundel (di luar komentar = ditolak, di komentar = disamarkan).
const join = (...p) => p.join("");
export const REAL_REFS = Object.freeze([
  join("wjjyqovhmwenb", "cvbnkgx"), // umkmpro-ai (BERSAMA/produksi)
  join("bmwpykwoylmz", "rbmbdeqw"), // linoe-otp-test
  join("kczslidqkhss", "dwefkais"), // apotek-binhafas
  join("eskqngzhtndk", "fqjoxxou"), // linoe-doku-sandbox
]);

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const norm = (p) => p.split(path.sep).join("/");

function refuse(problems) {
  const err = new Error(`REFUSED: ${problems.join(" | ")}`);
  err.problems = problems;
  return err;
}

/** Membaca dan memvalidasi bentuk manifest. Mengembalikan objek manifest. */
export function loadManifest(root) {
  const file = path.join(root, MANIFEST_PATH);
  if (!existsSync(file)) throw refuse([`manifest tidak ada: ${MANIFEST_PATH}`]);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw refuse([`manifest bukan JSON valid: ${e.message}`]);
  }
  return manifest;
}

function safeRelative(root, rel, mustStartWith) {
  const problems = [];
  if (typeof rel !== "string" || rel === "" || path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) {
    problems.push(`path tidak aman di manifest: ${String(rel)}`);
    return { problems, abs: null };
  }
  if (mustStartWith && !norm(rel).startsWith(mustStartWith)) problems.push(`path di luar ${mustStartWith}: ${rel}`);
  return { problems, abs: path.join(root, rel) };
}

/** Komentar baris `-- ...` dibuang; dipakai hanya untuk pencocokan pola (bukan untuk isi bundel). */
function stripLineComments(sql) {
  return sql.replace(/--[^\n]*/g, "");
}

/**
 * Menyamarkan ref proyek nyata yang ada di KOMENTAR baris; menolak bila ada di luar komentar.
 * Hanya komentar yang berubah (isi SQL yang dieksekusi tetap persis sama).
 */
function redactRefs(text, label, problems) {
  const out = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    let current = line;
    for (const ref of REAL_REFS) {
      if (!current.includes(ref)) continue;
      const commentAt = current.indexOf("--");
      const refAt = current.indexOf(ref);
      if (commentAt === -1 || refAt < commentAt) {
        problems.push(`${label}:${i + 1} memuat ref proyek nyata di luar komentar baris`);
        continue;
      }
      current = current.split(ref).join(REDACTED);
    }
    out.push(current);
  });
  return out.join("\n");
}

/**
 * Validasi penuh + pembentukan bundel. Murni: hanya membaca berkas di `root`.
 * @returns {{ sql: string, parts: string[], migrations: string[], bytes: number, partBytes: number[] }}
 */
export function buildBundle({ root, manifest = loadManifest(root), parts = 1 }) {
  const problems = [];

  if (manifest.version !== 1) problems.push("versi manifest tidak dikenal");
  if (manifest.targetProject?.ref !== "gasdqsadnjoknisloaec") problems.push("targetProject.ref bukan proyek QA yang diizinkan");
  if (manifest.bundleHeaderWarning !== WARNING_LINE) problems.push("bundleHeaderWarning tidak sesuai");
  if (manifest.approvalPhrase !== APPROVAL_PHRASE) problems.push("approvalPhrase tidak sesuai");
  if (!Array.isArray(manifest.shim) || manifest.shim.length === 0) problems.push("shim kosong");
  if (!Array.isArray(manifest.migrations) || manifest.migrations.length === 0) problems.push("migrations kosong");
  if (problems.length) throw refuse(problems);

  // 1) Berkas shim dan migrasi harus ada (satu pun hilang = tolak), path aman, urutan migrasi naik ketat.
  const shimFiles = [];
  for (const entry of manifest.shim) {
    const { problems: p, abs } = safeRelative(root, entry.file, "qa/");
    problems.push(...p);
    if (abs && !existsSync(abs)) problems.push(`berkas shim hilang: ${entry.file}`);
    else if (abs) shimFiles.push({ rel: entry.file, abs });
  }

  const migrationFiles = [];
  const seen = new Set();
  let previous = "";
  for (const name of manifest.migrations) {
    const rel = `supabase/migrations/${name}`;
    const { problems: p, abs } = safeRelative(root, rel, "supabase/migrations/");
    problems.push(...p);
    if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(name)) problems.push(`nama migrasi tidak valid: ${name}`);
    if (seen.has(name)) problems.push(`migrasi ganda: ${name}`);
    seen.add(name);
    if (previous && name <= previous) problems.push(`urutan tidak naik: ${name} setelah ${previous}`);
    previous = name;
    if (abs && !existsSync(abs)) problems.push(`berkas migrasi hilang: ${name}`);
    else if (abs) migrationFiles.push({ name, rel, abs });
  }
  if (problems.length) throw refuse(problems);

  // 2) Baca semua berkas, periksa pola terlarang pada migrasi, samarkan ref di komentar.
  const patterns = (manifest.forbidden?.sqlPatterns ?? []).map((p) => ({ name: p.name, re: new RegExp(p.regex, "i") }));
  const allowedPrefixes = manifest.forbidden?.allowedPublicTablePrefixes ?? [];

  const shimParts = shimFiles.map((f) => {
    const raw = readFileSync(f.abs, "utf8");
    if (!raw.includes("ABORT: schema public tidak kosong")) problems.push(`${f.rel}: guard 'proyek kosong' tidak ditemukan`);
    return { rel: f.rel, text: redactRefs(raw, f.rel, problems).replace(/\s+$/, "") };
  });

  const migrationParts = migrationFiles.map((f) => {
    const raw = readFileSync(f.abs, "utf8");
    const code = stripLineComments(raw);
    for (const { name, re } of patterns) {
      if (re.test(code)) problems.push(`${f.name}: pola terlarang (${name})`);
    }
    for (const m of code.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi)) {
      if (!allowedPrefixes.some((pre) => m[1].startsWith(pre))) problems.push(`${f.name}: membuat tabel di luar awalan yang diizinkan (${m[1]})`);
    }
    return {
      name: f.name,
      version: f.name.slice(0, 14),
      hash: sha256(raw), // hash berkas ASLI (sebelum penyamaran komentar)
      text: redactRefs(raw, f.name, problems).replace(/\s+$/, ""),
    };
  });
  if (problems.length) throw refuse(problems);

  // 3) Rangkai bundel. Deterministik (tanpa cap waktu). Satu berkas = satu transaksi; mode --parts membagi di batas migrasi.
  const total = shimParts.length + migrationParts.length;
  const expectCounts = migrationParts.length;

  /** Satu bagian: shim (hanya bagian pertama) + migrasi [from, to). Atomik sendiri; urutan dijaga guard versi. */
  const render = ({ from, to, index, count }) => {
    const first = index === 1;
    const last = index === count;
    const mig = migrationParts.slice(from, to);
    const out = [];
    out.push(
      `-- ============================================================================`,
      `-- ${WARNING_LINE}`,
      `-- ============================================================================`,
      `-- BUNDEL SKEMA MINIMUM QA-2 (dibangun scripts/qa/build-schema-bundle.mjs; sumber: ${MANIFEST_PATH}).`,
      `-- JANGAN dijalankan di proyek lain. Terutama BUKAN di umkmpro-ai (proyek bersama UMKMpro / produksi),`,
      `-- linoe-otp-test, apotek-binhafas, maupun linoe-doku-sandbox. Cocokkan ref gasdqsadnjoknisloaec di URL dashboard SEBELUM menempel.`,
      `-- Menerapkan bundel ini butuh persetujuan Founder: ${APPROVAL_PHRASE}`,
      `-- Isi: ${shimParts.length} shim + ${expectCounts} migrasi (${total} bagian). Shim BUKAN produksi (risiko fidelitas TINGGI): lihat docs/QA2_SCHEMA_MINIMUM.md.`,
      `-- Ref proyek nyata di komentar migrasi disamarkan menjadi ${REDACTED}; SQL yang dieksekusi tidak diubah.`,
      `-- Rollback: hapus lalu buat ulang proyek QA (terpisah dari produksi).`,
    );
    if (count === 1) {
      out.push(`-- Bundel menolak dirinya sendiri (ABORT) bila proyek tidak kosong, dan berjalan dalam SATU transaksi (semua atau tidak sama sekali).`);
    } else {
      out.push(
        `-- BAGIAN ${index} DARI ${count}: tempel dan jalankan BERURUTAN (1, 2, ...), satu per satu, jangan dilewati atau dibalik.`,
        `-- Tiap bagian atomik (satu transaksi). Bagian ${first ? "pertama menolak proyek yang tidak kosong" : "ini menolak berjalan bila bagian sebelumnya belum diterapkan atau dirinya sudah diterapkan"}.`,
        `-- Bila sebuah bagian gagal: tidak ada yang tersimpan dari bagian itu; kirim galatnya. Bagian sebelumnya tetap terpasang (rollback = hapus dan buat ulang proyek QA).`,
      );
    }
    out.push(`-- ============================================================================`, ``);
    if (!first) {
      const prev = migrationParts[from - 1].version;
      const mine = mig[0].version;
      out.push(
        `do $order$`,
        `begin`,
        `  if to_regclass('public._linoe_sandbox_applied') is null`,
        `     or not exists (select 1 from public._linoe_sandbox_applied where version = '${prev}') then`,
        `    raise exception 'ABORT: bagian sebelumnya belum diterapkan (versi ${prev} tidak ada). Jalankan bagian secara berurutan.';`,
        `  end if;`,
        `  if exists (select 1 from public._linoe_sandbox_applied where version = '${mine}') then`,
        `    raise exception 'ABORT: bagian ini sudah diterapkan (versi ${mine}). Jangan dijalankan dua kali.';`,
        `  end if;`,
        `end $order$;`,
        ``,
      );
    }
    out.push(`begin;`, ``);
    if (first) {
      shimParts.forEach((sp, i) => out.push(`-- ---- [${i + 1}/${total}] SHIM ${sp.rel} (BUKAN produksi) ----`, sp.text, ``));
    }
    mig.forEach((m, i) => {
      const n = shimParts.length + from + i + 1;
      out.push(`-- ---- [${n}/${total}] MIGRASI ${m.name} ----`, m.text, ``);
    });
    out.push(
      `-- ---- pelacak versi (sha256 berkas migrasi asli di repo) ----`,
      `insert into public._linoe_sandbox_applied (version, sha256) values`,
      mig.map((m) => `  ('${m.version}', '${m.hash}')`).join(",\n") + `;`,
      ``,
      `notify pgrst, 'reload schema';`,
      ``,
      `commit;`,
      ``,
    );
    if (last) {
      out.push(
        `-- ---- verifikasi BACA-SAJA (hasil terakhir tampil di SQL Editor). Harapan: migrations_applied=${expectCounts}, trial_trigger=O, free_plan_active=1, signup_trigger=1, shim_policies=3, authenticated_access=true, service_role_access=true, app_table_grants=true, reset_trigger=1 ----`,
        `select`,
        `  (select count(*) from public._linoe_sandbox_applied) as migrations_applied,`,
        `  (select tgenabled from pg_trigger where tgname = 'trg_prompter_subscriptions_enforce_trial_insert') as trial_trigger,`,
        `  (select count(*) from public.prompter_plan_entitlements where plan = 'FREE' and availability = 'ACTIVE') as free_plan_active,`,
        `  (select count(*) from pg_trigger where tgname = 'qa_on_auth_user_created') as signup_trigger,`,
        `  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('tenants', 'user_profiles')) as shim_policies,`,
        `  (has_table_privilege('authenticated', 'public.tenants', 'select')`,
        `    and has_table_privilege('authenticated', 'public.user_profiles', 'select')`,
        `    and has_function_privilege('authenticated', 'public.fn_current_tenant_id()', 'execute')`,
        `    and has_function_privilege('authenticated', 'public.fn_current_role()', 'execute')) as authenticated_access,`,
        `  (has_table_privilege('service_role', 'public.tenants', 'select')`,
        `    and has_table_privilege('service_role', 'public.user_profiles', 'select')`,
        `    and has_table_privilege('service_role', 'public.prompter_subscriptions', 'select')) as service_role_access,`,
        `  (has_table_privilege('authenticated', 'public.prompter_brand_profiles', 'insert')`,
        `    and has_table_privilege('authenticated', 'public.prompter_audit_logs', 'insert')`,
        `    and has_table_privilege('authenticated', 'public.prompter_subscriptions', 'insert')`,
        `    and has_table_privilege('authenticated', 'public.prompter_subscriptions', 'select')`,
        `    and has_table_privilege('authenticated', 'public.prompter_analytics_insights', 'select')) as app_table_grants,`,
        `  (select count(*) from pg_trigger where tgname = 'qa2_before_auth_user_delete') as reset_trigger;`,
        ``,
      );
    }
    return out.join("\n");
  };

  const sql = render({ from: 0, to: migrationParts.length, index: 1, count: 1 });

  // Pembagian opsional di batas migrasi (urutan TIDAK berubah): pilih batas terdekat ke k * total / N berdasarkan ukuran.
  const wanted = Number.isInteger(parts) && parts >= 1 ? parts : 1;
  if (wanted > migrationParts.length) throw refuse([`--parts ${wanted} lebih besar dari jumlah migrasi`]);
  const sizes = migrationParts.map((m) => Buffer.byteLength(m.text, "utf8"));
  const shimBytes = shimParts.reduce((n, sp) => n + Buffer.byteLength(sp.text, "utf8"), 0);
  const cuts = [0];
  for (let k = 1; k < wanted; k++) {
    const target = ((shimBytes + sizes.reduce((a, b) => a + b, 0)) * k) / wanted;
    let best = cuts[cuts.length - 1] + 1;
    let bestDiff = Infinity;
    let cum = shimBytes;
    for (let i = 0; i < migrationParts.length; i++) {
      cum += sizes[i];
      const boundary = i + 1;
      if (boundary <= cuts[cuts.length - 1] || boundary > migrationParts.length - (wanted - k)) continue;
      const diff = Math.abs(cum - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = boundary;
      }
    }
    cuts.push(best);
  }
  cuts.push(migrationParts.length);
  const partTexts = [];
  for (let i = 0; i < wanted; i++) partTexts.push(wanted === 1 ? sql : render({ from: cuts[i], to: cuts[i + 1], index: i + 1, count: wanted }));

  // 4) Pemeriksaan akhir: tidak boleh ada ref proyek nyata sama sekali; header peringatan di SETIAP bagian.
  for (const text of [sql, ...partTexts]) {
    const leaked = REAL_REFS.filter((r) => text.includes(r));
    if (leaked.length) throw refuse([`bundel memuat ${leaked.length} ref proyek nyata setelah penyamaran`]);
    if (!text.includes(WARNING_LINE)) throw refuse(["header peringatan tidak ada di bundel"]);
  }

  return {
    sql,
    parts: partTexts,
    migrations: migrationParts.map((m) => m.name),
    bytes: Buffer.byteLength(sql, "utf8"),
    partBytes: partTexts.map((t) => Buffer.byteLength(t, "utf8")),
  };
}

function parseArgs(argv) {
  const args = { out: null, check: false, root: null, parts: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") args.out = argv[++i] ?? "";
    else if (a === "--check") args.check = true;
    else if (a === "--root") args.root = argv[++i] ?? "";
    else if (a === "--parts") args.parts = Number(argv[++i]);
    else throw refuse([`argumen tidak dikenal: ${a}`]);
  }
  return args;
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.root ?? path.join(here, "..", ".."));
  if (!Number.isInteger(args.parts) || args.parts < 1 || args.parts > 6) throw refuse(["--parts harus bilangan bulat 1..6"]);
  if (args.parts > 1 && (args.out === null || args.check)) throw refuse(["--parts butuh --out (satu berkas per bagian)"]);
  const { sql, parts, migrations, bytes, partBytes } = buildBundle({ root, parts: args.parts });

  if (args.check) {
    console.error(`CHECK_OK migrations=${migrations.length} bytes=${bytes}`);
    return;
  }
  if (args.out !== null) {
    if (!args.out) throw refuse(["--out butuh path"]);
    const target = path.resolve(args.out);
    const inside = (dir) => {
      const rel = path.relative(path.join(root, dir), target);
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    };
    if (inside("supabase") || inside(".git") || inside("qa")) {
      throw refuse(["path keluaran tidak boleh berada di supabase/, qa/, atau .git (jangan menimpa sumber)"]);
    }
    mkdirSync(path.dirname(target), { recursive: true });
    if (args.parts === 1) {
      writeFileSync(target, sql, "utf8");
      console.error(`BUNDLE_WRITTEN path=${target} migrations=${migrations.length} bytes=${bytes} sha256=${sha256(sql)}`);
    } else {
      const ext = path.extname(target);
      const stem = target.slice(0, target.length - ext.length);
      parts.forEach((text, i) => {
        const file = `${stem}.part${i + 1}of${parts.length}${ext || ".sql"}`;
        writeFileSync(file, text, "utf8");
        console.error(`PART_WRITTEN path=${file} bytes=${partBytes[i]} sha256=${sha256(text)}`);
      });
    }
    return;
  }
  process.stdout.write(sql);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
