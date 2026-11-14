#!/usr/bin/env node
// QA-2: pencetak SQL RESET proyek QA (identitas QA tetap + tenant yatim). Node murni, TIDAK terhubung ke database/jaringan:
// hanya MENCETAK SQL ke stdout atau MENULIS satu berkas teks (--out). Tidak menjalankan apa pun.
//
//   node scripts/qa/print-qa-reset-sql.mjs --ref gasdqsadnjoknisloaec                  # cetak ke stdout
//   node scripts/qa/print-qa-reset-sql.mjs --ref gasdqsadnjoknisloaec --out /path/di/luar/repo/qa2-reset.sql
//   node scripts/qa/print-qa-reset-sql.mjs --ref gasdqsadnjoknisloaec --with-auth-user  # tambah DELETE auth.users (bukan jalur resmi; lebih baik Admin API)
//
// Guard: --ref wajib persis ref di allowlist QA (scripts/qa/qa-project-allowlist.mjs); ref proyek nyata ditolak. SQL hasilnya juga
// menolak berjalan bila proyek tidak berpenanda QA2_SANDBOX_ONLY (dibuat shim). Kebutuhan: tenants yatim tertinggal saat user Auth
// dihapus (user_profiles ikut terhapus lewat FK, tenants tidak). Lihat docs/QA2_SCHEMA_MINIMUM.md bagian "Reset QA".
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ALLOWED_QA_PROJECT_REFS } from "./qa-project-allowlist.mjs";

export const QA_IDENTITY_EMAIL = "qa-linoe@example.test";
export const WARNING_LINE = "HANYA UNTUK PROYEK QA gasdqsadnjoknisloaec";

const join = (...p) => p.join("");
// Ref proyek nyata (disusun dari potongan; tidak boleh dipakai di sini). Disamakan dengan local-stack-guard oleh tes.
const REAL_REFS = Object.freeze([
  join("wjjyqovhmwenb", "cvbnkgx"),
  join("bmwpykwoylmz", "rbmbdeqw"),
  join("kczslidqkhss", "dwefkais"),
  join("eskqngzhtndk", "fqjoxxou"),
]);

function refuse(msg) {
  return new Error(`REFUSED: ${msg}`);
}

/** @returns {string} teks SQL reset. Murni (tanpa I/O). */
export function buildResetSql({ ref, withAuthUser = false } = {}) {
  if (typeof ref !== "string" || ref === "") throw refuse("--ref wajib diisi (ref proyek QA)");
  if (REAL_REFS.includes(ref)) throw refuse("ref proyek nyata/produksi ditolak");
  if (!ALLOWED_QA_PROJECT_REFS.includes(ref)) throw refuse("ref tidak ada di allowlist QA");

  const lines = [
    `-- ============================================================================`,
    `-- ${WARNING_LINE}`,
    `-- ============================================================================`,
    `-- RESET QA-2 (dicetak scripts/qa/print-qa-reset-sql.mjs). BELUM dijalankan oleh siapa pun.`,
    `-- Cocokkan ref ${ref} di URL dashboard SEBELUM menempel. JANGAN di umkmpro-ai atau proyek lain.`,
    `-- Menghapus data identitas QA tetap (${QA_IDENTITY_EMAIL}) dan tenant yatim. Satu transaksi; menolak jalan bila penanda`,
    `-- QA2_SANDBOX_ONLY (dibuat shim QA-2) tidak ada. Butuh persetujuan Founder sebelum dijalankan.`,
    `-- ============================================================================`,
    ``,
    `begin;`,
    ``,
    `do $guard$`,
    `begin`,
    `  if to_regclass('public._linoe_sandbox_marker') is null`,
    `     or not exists (select 1 from public._linoe_sandbox_marker where purpose like 'QA2_SANDBOX_ONLY%') then`,
    `    raise exception 'ABORT: bukan proyek QA-2 (penanda QA2_SANDBOX_ONLY tidak ada). Berhenti.';`,
    `  end if;`,
    `end $guard$;`,
    ``,
    `-- 1) Tenant milik identitas QA tetap. FK on delete cascade menghapus user_profiles dan semua baris prompter_* tenant itu`,
    `--    (termasuk langganan/trial). Dilakukan SEBELUM user Auth dihapus agar audit log tidak menahan penghapusan user.`,
    `delete from public.tenants`,
    `where id in (`,
    `  select up.tenant_id from public.user_profiles up join auth.users u on u.id = up.id`,
    `  where u.email = '${QA_IDENTITY_EMAIL}'`,
    `);`,
    ``,
    `-- 2) Sapu tenant yatim (tanpa satu pun user_profiles), sisa penghapusan user lama. Hanya aman di proyek QA.`,
    `delete from public.tenants t`,
    `where not exists (select 1 from public.user_profiles up where up.tenant_id = t.id);`,
    ``,
  ];
  if (withAuthUser) {
    lines.push(
      `-- 3) (opsional, --with-auth-user) Hapus user Auth QA lewat SQL. Jalur resmi lebih baik: dashboard Authentication > Users atau Admin API.`,
      `delete from auth.users where email = '${QA_IDENTITY_EMAIL}';`,
      ``,
    );
  } else {
    lines.push(
      `-- 3) User Auth QA TIDAK dihapus di sini: hapus lewat dashboard (Authentication > Users) atau Admin API khusus proyek QA.`,
      ``,
    );
  }
  lines.push(
    `commit;`,
    ``,
    `-- verifikasi BACA-SAJA. Harapan setelah reset penuh: qa_tenants_left=0, orphan_tenants=0${withAuthUser ? ", qa_auth_users_left=0" : ""}.`,
    `select`,
    `  (select count(*) from public.tenants t join public.user_profiles up on up.tenant_id = t.id join auth.users u on u.id = up.id`,
    `     where u.email = '${QA_IDENTITY_EMAIL}') as qa_tenants_left,`,
    `  (select count(*) from public.tenants t where not exists (select 1 from public.user_profiles up where up.tenant_id = t.id)) as orphan_tenants,`,
    `  (select count(*) from auth.users where email = '${QA_IDENTITY_EMAIL}') as qa_auth_users_left;`,
    ``,
  );
  return lines.join("\n");
}

function parseArgs(argv) {
  const args = { ref: null, out: null, withAuthUser: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ref") args.ref = argv[++i] ?? "";
    else if (a === "--out") args.out = argv[++i] ?? "";
    else if (a === "--with-auth-user") args.withAuthUser = true;
    else throw refuse(`argumen tidak dikenal: ${a}`);
  }
  return args;
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, "..", "..");
  const args = parseArgs(process.argv.slice(2));
  const sql = buildResetSql({ ref: args.ref ?? "", withAuthUser: args.withAuthUser });
  if (args.out === null) {
    process.stdout.write(sql);
    return;
  }
  if (!args.out) throw refuse("--out butuh path");
  const target = path.resolve(args.out);
  for (const dir of ["supabase", ".git", "qa", "scripts"]) {
    const rel = path.relative(path.join(root, dir), target);
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) throw refuse(`path keluaran tidak boleh di ${dir}/`);
  }
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, sql, "utf8");
  console.error(`RESET_SQL_WRITTEN path=${target} bytes=${Buffer.byteLength(sql, "utf8")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
