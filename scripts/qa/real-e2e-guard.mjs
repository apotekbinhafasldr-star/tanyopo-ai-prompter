import { findViolations } from "./local-stack-guard.mjs";
import { ALLOWED_QA_PROJECT_REFS } from "./qa-project-allowlist.mjs";

// QA-2 guard (jalur B, REAL email). Fail-closed: keraguan apa pun = melempar error.
// Hanya NAMA variabel yang pernah muncul di pesan error; nilai tidak pernah dicetak.
// Daftar blokir proyek/host/variabel produksi DIPAKAI ULANG dari local-stack-guard.mjs (tidak diduplikasi di sini).

export const CONFIRM_PHRASE = "RUN-QA-2-REAL-EMAIL";
export const PRODUCTION_SENDER_DOMAIN = "tanyopo.com";

// Variabel wajib (nama saja).
export const REQUIRED_VARS = [
  "QA2_CONFIRM",
  "QA_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "QA_PROJECT_REF_EXPECTED",
  "QA_SUPABASE_PUBLISHABLE_KEY",
  "QA_SUPABASE_SECRET_KEY",
  "QA_INBOX_ADDRESS",
  "QA_SENDER_EMAIL",
];

// Variabel yang nilainya rahasia: disamarkan oleh redact().
export const SECRET_VARS = [
  "QA_SUPABASE_PUBLISHABLE_KEY",
  "QA_SUPABASE_SECRET_KEY",
  "QA_RESEND_SMTP_PASSWORD",
  "QA_INBOX_READ_TOKEN",
];

// Tambahan di luar daftar local-stack-guard: variabel produksi/pihak ketiga yang tidak boleh ada di lingkungan QA-2.
const EXTRA_FORBIDDEN_NAMES = [
  "PGHOST",
  "PGPORT",
  "PGUSER",
  "PGPASSWORD",
  "PGDATABASE",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_SERVICE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
];
const FORBIDDEN_PREFIXES = ["DOKU_", "MIDTRANS_", "META_", "TIKTOK_", "X_CLIENT_", "RESEND_", "NETLIFY_", "VERCEL_"];

const QA_URL_RE = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/;
const REF_RE = /^[a-z0-9]{20}$/;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)$/;

/**
 * Menyamarkan nilai rahasia pada teks. Murni.
 * @param {string} text
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
export function redact(text, env) {
  let out = String(text);
  for (const name of SECRET_VARS) {
    const value = env[name];
    if (typeof value === "string" && value.length > 0) out = out.split(value).join(`[REDACTED:${name}]`);
  }
  return out;
}

/**
 * @param {string} value
 * @returns {string | null} domain huruf kecil bila alamat email valid, selain itu null
 */
function emailDomain(value) {
  const m = EMAIL_RE.exec(value);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Mengembalikan daftar pelanggaran (kosong = aman). Murni; hanya memuat NAMA variabel.
 * @param {Record<string, string | undefined>} env
 * @param {{ allowedRefs?: readonly string[] }} [options] allowlist ref proyek QA (bawaan: berkas terkunci di repo; untuk tes)
 * @returns {string[]}
 */
export function findRealQaViolations(env, options = {}) {
  /** @type {string[]} */
  const out = [];
  const allowedRefs = options.allowedRefs ?? ALLOWED_QA_PROJECT_REFS;

  if (env.QA2_CONFIRM !== CONFIRM_PHRASE) out.push("QA2_CONFIRM tidak sesuai frasa konfirmasi");

  for (const name of REQUIRED_VARS) {
    const v = env[name];
    if (typeof v !== "string" || v.trim() === "") out.push(`${name} wajib diisi`);
  }

  // Proyek Supabase QA: URL, ref, dan kecocokan dengan ref yang diharapkan.
  const url = env.QA_SUPABASE_URL;
  const expected = env.QA_PROJECT_REF_EXPECTED;
  /** @type {string | null} */
  let qaRef = null;
  if (typeof url === "string" && url !== "") {
    const m = QA_URL_RE.exec(url);
    if (m) qaRef = m[1];
    else out.push("QA_SUPABASE_URL tidak berformat https://<ref-20-karakter>.supabase.co");
  }
  if (typeof expected === "string" && expected !== "" && !REF_RE.test(expected)) {
    out.push("QA_PROJECT_REF_EXPECTED bukan ref 20 karakter");
  }
  if (qaRef !== null && typeof expected === "string" && expected !== "" && qaRef !== expected) {
    out.push("ref pada QA_SUPABASE_URL tidak sama dengan QA_PROJECT_REF_EXPECTED");
  }
  // Allowlist terkunci di repo, independen dari URL/secret yang disuplai runner. Kosong = selalu menolak.
  if (allowedRefs.length === 0) {
    out.push("allowlist proyek QA kosong (scripts/qa/qa-project-allowlist.mjs): belum ada proyek QA yang diizinkan");
  } else if (qaRef !== null && !allowedRefs.includes(qaRef)) {
    out.push("ref pada QA_SUPABASE_URL tidak ada di allowlist proyek QA");
  }
  for (const ref of allowedRefs) {
    if (!REF_RE.test(ref) || findViolations({ REF: ref }).length > 0) {
      out.push("allowlist proyek QA memuat ref tidak valid atau proyek produksi/bersama");
      break;
    }
  }
  // Ref tidak boleh termasuk proyek produksi/bersama (daftar blokir dari local-stack-guard).
  for (const [name, ref] of [
    ["QA_SUPABASE_URL", qaRef],
    ["QA_PROJECT_REF_EXPECTED", typeof expected === "string" ? expected : null],
  ]) {
    if (ref && findViolations({ REF: ref }).length > 0) out.push(`${name} memuat ref proyek produksi/bersama`);
  }

  // Alamat kotak masuk tetap: email valid, bukan example.test.
  const inbox = env.QA_INBOX_ADDRESS;
  if (typeof inbox === "string" && inbox !== "") {
    const d = emailDomain(inbox);
    if (d === null) out.push("QA_INBOX_ADDRESS bukan alamat email valid");
    else if (d === "example.test" || d.endsWith(".example.test")) out.push("QA_INBOX_ADDRESS tidak boleh di example.test");
  }

  // Pengirim: tidak boleh domain produksi persis (tanyopo.com); sub-domain QA atau domain lain diperbolehkan.
  const sender = env.QA_SENDER_EMAIL;
  if (typeof sender === "string" && sender !== "") {
    const d = emailDomain(sender);
    if (d === null) out.push("QA_SENDER_EMAIL bukan alamat email valid");
    else if (d === PRODUCTION_SENDER_DOMAIN) out.push("QA_SENDER_EMAIL memakai domain pengirim produksi");
  }

  // Tidak boleh ada variabel produksi. Daftar nama dipakai ulang dari local-stack-guard (findViolations).
  for (const msg of findViolations(env)) {
    const forbidden = /^variabel terlarang terisi: (\S+)$/.exec(msg);
    if (forbidden) out.push(`variabel produksi terisi: ${forbidden[1]}`);
    const marker = /^(\S+) memuat penanda layanan nyata \((.+)\)$/.exec(msg);
    // ".supabase.co" generik wajib ada pada URL QA; selebihnya (ref nyata, netlify.app, api.resend.com) ditolak.
    if (marker && marker[2] !== ".supabase.co") out.push(`${marker[1]} memuat penanda layanan produksi`);
  }
  for (const name of Object.keys(env)) {
    const v = env[name];
    if (typeof v !== "string" || v === "") continue;
    if (EXTRA_FORBIDDEN_NAMES.includes(name) || FORBIDDEN_PREFIXES.some((p) => name.startsWith(p))) {
      out.push(`variabel produksi terisi: ${name}`);
    }
  }
  // NEXT_PUBLIC_SUPABASE_URL wajib terisi (lihat REQUIRED_VARS) dan identik dengan QA_SUPABASE_URL; SUPABASE_URL, bila ada, juga.
  const pub = env.NEXT_PUBLIC_SUPABASE_URL;
  if (typeof pub === "string" && pub.trim() !== "" && pub !== url) out.push("NEXT_PUBLIC_SUPABASE_URL bukan proyek QA");
  const plain = env.SUPABASE_URL;
  if (typeof plain === "string" && plain !== "" && plain !== url) out.push("SUPABASE_URL bukan proyek QA");

  return [...new Set(out)];
}

/**
 * Fail-closed: melempar error bila ada pelanggaran. Pesan hanya memuat nama variabel.
 * @param {Record<string, string | undefined>} env
 * @param {{ allowedRefs?: readonly string[] }} [options]
 */
export function assertRealQaEnv(env, options = {}) {
  const violations = findRealQaViolations(env, options);
  if (violations.length > 0) {
    throw new Error(`QA-2 GUARD REFUSED:\n - ${violations.join("\n - ")}`);
  }
}
