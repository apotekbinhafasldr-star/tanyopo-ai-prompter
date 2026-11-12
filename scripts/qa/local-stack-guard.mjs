import { fileURLToPath } from "node:url";

// QA-1 guard (fail-closed): memastikan SEMUA target Supabase/database/email mengarah ke mesin lokal runner CI.
// Dipakai oleh scripts/qa/signup-e2e.mjs dan scripts/qa/apply-local-db.sh (lewat CLI di bawah). Tidak membaca secret apa pun.

export const QA_EMAIL = "qa-linoe@example.test";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// Variabel yang berarti kredensial/target produksi atau layanan eksternal: TIDAK BOLEH ada di lingkungan QA.
const FORBIDDEN_VARS = [
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
  "POSTGRES_URL",
  "TOKEN_ENCRYPTION_KEY",
  "PAYMENT_PROVIDER_API_KEY",
  "PAYMENT_SWEEPER_SECRET",
  "RESEND_ALERT_API_KEY",
  "RESEND_API_KEY",
  "NETLIFY_AUTH_TOKEN",
  "NETLIFY_SITE_ID",
  "DEMO_SESSION_SECRET",
];

// Referensi proyek Supabase nyata milik Founder dan host layanan produksi: tidak boleh muncul di nilai env mana pun.
const FORBIDDEN_FRAGMENTS = [
  "wjjyqovhmwenbcvbnkgx", // umkmpro-ai (BERSAMA)
  "bmwpykwoylmzrbmbdeqw", // linoe-otp-test
  "kczslidqkhssdwefkais", // apotek-binhafas
  "eskqngzhtndkfqjoxxou", // linoe-doku-sandbox
  ".supabase.co",
  ".supabase.com",
  "netlify.app",
  "api.resend.com",
];

const URL_VARS = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL", "NEXT_PUBLIC_APP_URL", "MAILPIT_URL"];

function hostOf(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

/** Mengembalikan daftar pelanggaran (array kosong = aman). Murni, tanpa efek samping. */
export function findViolations(env) {
  const out = [];
  for (const name of FORBIDDEN_VARS) {
    if (env[name]) out.push(`variabel terlarang terisi: ${name}`);
  }
  for (const name of URL_VARS) {
    const v = env[name];
    if (!v) continue;
    const host = hostOf(v);
    if (host === null || !LOCAL_HOSTS.has(host)) out.push(`${name} bukan localhost (host=${host ?? "tidak valid"})`);
  }
  const pgHost = env.PGHOST;
  if (pgHost && !pgHost.startsWith("/") && !LOCAL_HOSTS.has(pgHost)) out.push(`PGHOST bukan localhost (${pgHost})`);
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== "string") continue;
    for (const frag of FORBIDDEN_FRAGMENTS) {
      if (value.includes(frag)) out.push(`${name} memuat penanda layanan nyata (${frag})`);
    }
  }
  return out;
}

/** Fail-closed: melempar error (dan CLI keluar dengan kode 2) bila ada pelanggaran atau target wajib tidak ada. */
export function assertLocalOnly(env, { requireUrls = [] } = {}) {
  const violations = findViolations(env);
  for (const name of requireUrls) {
    if (!env[name]) violations.push(`${name} wajib diisi (target lokal)`);
  }
  if (violations.length > 0) {
    throw new Error(`QA GUARD REFUSED:\n - ${violations.join("\n - ")}`);
  }
}

/** Identitas QA hanya boleh domain .test (tidak pernah bisa menjadi alamat nyata). */
export function assertQaEmail(email) {
  if (email !== QA_EMAIL) throw new Error(`QA GUARD REFUSED: email harus ${QA_EMAIL}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    assertLocalOnly(process.env, { requireUrls: process.argv.slice(2) });
    console.log("QA guard: OK (semua target lokal, tanpa kredensial produksi)");
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(2);
  }
}
