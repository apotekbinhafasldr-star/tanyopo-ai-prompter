import { findViolations } from "./local-stack-guard.mjs";
import { ALLOWED_QA_PROJECT_REFS } from "./qa-project-allowlist.mjs";
import { isLockedQaAddress, redact } from "./real-e2e-guard.mjs";

// QA-2 admin client: SERVER-SIDE, runner QA saja. Mengelola SATU identitas QA tetap (reset + baca trial).
// INERT: tidak diimpor oleh real-e2e.mjs main(); tidak boleh diimpor dari app/**, components/**, features/**.
// Tanpa dependensi baru: hanya fetch ke Supabase Admin REST (GoTrue admin + PostgREST service key).
// Tidak ada operasi massal, tidak ada fungsi mengubah/memperpanjang trial. Lihat docs/QA2_ADMIN_CLIENT.md.

const QA_URL_RE = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 262_144;
const LOOKUP_PAGE_SIZE = 20;

export class QaAdminError extends Error {
  /** @param {string} message sudah bersih dari secret */
  constructor(message) {
    super(message);
    this.name = "QaAdminError";
  }
}

function fail(message) {
  throw new QaAdminError(message);
}

/**
 * @param {{ url: string, secretKey: string, expectedRef: string, identityEmail: string, fetchImpl?: typeof fetch, timeoutMs?: number, maxBytes?: number }} opts
 */
export function createQaAdminClient(opts) {
  const o = opts && typeof opts === "object" ? opts : fail("opsi wajib berupa objek");
  const { url, secretKey, expectedRef, identityEmail } = o;
  const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = o.maxBytes ?? DEFAULT_MAX_BYTES;
  const fetchImpl = o.fetchImpl ?? globalThis.fetch;

  // (a) fail-closed saat konstruksi. Pesan hanya memuat NAMA bidang, tidak pernah nilainya.
  if (typeof url !== "string") fail("url wajib string");
  const m = QA_URL_RE.exec(url);
  if (!m) fail("url bukan https://<ref-20-karakter>.supabase.co persis");
  const ref = m[1];
  if (!ALLOWED_QA_PROJECT_REFS.includes(ref)) fail("ref url tidak ada di allowlist proyek QA");
  if (typeof expectedRef !== "string" || expectedRef !== ref) fail("ref url tidak sama dengan expectedRef");
  if (findViolations({ REF: ref }).length > 0) fail("ref url adalah proyek produksi/bersama");
  if (typeof secretKey !== "string" || secretKey.trim() === "") fail("secretKey wajib diisi");
  if (typeof fetchImpl !== "function") fail("fetch tidak tersedia");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) fail("timeoutMs tidak valid");
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 1_048_576) fail("maxBytes tidak valid");
  // (b) identitas terkunci: satu alamat @qa.tanyopo.com tanpa plus-address (validator yang sama dengan guard).
  if (!isLockedQaAddress(identityEmail)) fail("identityEmail wajib satu alamat tunggal @qa.tanyopo.com tanpa plus-address");

  const secretEnv = { QA_SUPABASE_SECRET_KEY: secretKey };
  /** @param {unknown} text */
  const scrub = (text) => redact(String(text), secretEnv).split(secretKey).join("[REDACTED]");
  const origin = url;

  /** @param {unknown} email */
  function assertIdentity(email, op) {
    if (typeof email !== "string" || email !== identityEmail) fail(`${op}: ditolak, email bukan identitas QA terkunci`);
  }
  /** @param {unknown} id */
  function assertUuid(id, op) {
    if (typeof id !== "string" || !UUID_RE.test(id)) fail(`${op}: id bukan UUID`);
    return id;
  }

  /** @param {Response} res */
  async function readCapped(res, op) {
    const declared = Number(res.headers?.get?.("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) fail(`${op}: respons melebihi batas ukuran`);
    let text;
    if (res.body && typeof res.body.getReader === "function") {
      const reader = res.body.getReader();
      const chunks = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          try { await reader.cancel(); } catch { /* abaikan */ }
          fail(`${op}: respons melebihi batas ukuran`);
        }
        chunks.push(value);
      }
      text = Buffer.concat(chunks).toString("utf8");
    } else {
      text = await res.text();
      if (text.length > maxBytes) fail(`${op}: respons melebihi batas ukuran`);
    }
    if (text === "") return null;
    try {
      return JSON.parse(text);
    } catch {
      return fail(`${op}: respons bukan JSON`);
    }
  }

  // Satu-satunya jalur jaringan. Tanpa retry. Path berasal dari kode ini saja, nilai query sudah divalidasi/di-encode.
  async function call(op, method, pathAndQuery, extraHeaders = {}) {
    const target = `${origin}${pathAndQuery}`;
    if (new URL(target).origin !== origin) fail(`${op}: target di luar proyek QA`);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(target, {
        method,
        redirect: "error",
        signal: ctl.signal,
        headers: { apikey: secretKey, authorization: `Bearer ${secretKey}`, accept: "application/json", ...extraHeaders },
      });
      if (!res.ok) {
        let code = "";
        try {
          const body = await readCapped(res, op);
          if (body && typeof body.code === "string" && /^[A-Za-z0-9_]{1,16}$/.test(body.code)) code = ` code=${body.code}`;
        } catch { /* badan galat tidak dipakai */ }
        return fail(`${op}: HTTP ${res.status}${code}`);
      }
      return await readCapped(res, op);
    } catch (e) {
      if (e instanceof QaAdminError) throw e;
      const aborted = ctl.signal.aborted;
      return fail(`${op}: ${aborted ? "timeout" : "gagal jaringan"} (${scrub(e instanceof Error ? e.name : "error")})`);
    } finally {
      clearTimeout(timer);
    }
  }

  const eq = (v) => `eq.${encodeURIComponent(v)}`;

  /** Mengembalikan {id} identitas atau null. UNKNOWN: dukungan parameter filter GoTrue; halaman penuh tanpa kecocokan = galat. */
  async function lookupIdentity(op) {
    const q = `filter=${encodeURIComponent(identityEmail)}&page=1&per_page=${LOOKUP_PAGE_SIZE}`;
    const body = await call(op, "GET", `/auth/v1/admin/users?${q}`);
    const users = Array.isArray(body?.users) ? body.users : fail(`${op}: bentuk respons tidak dikenal`);
    const hits = users.filter((u) => typeof u?.email === "string" && u.email.toLowerCase() === identityEmail.toLowerCase());
    if (hits.length > 1) fail(`${op}: lebih dari satu pengguna cocok (ambigu)`);
    if (hits.length === 1) return { id: assertUuid(hits[0].id, op) };
    if (users.length >= LOOKUP_PAGE_SIZE) fail(`${op}: pencarian ambigu (halaman penuh tanpa kecocokan; filter tidak didukung?)`);
    return null;
  }

  /** Relasi: auth user -> public.user_profiles(id, tenant_id) -> public.tenants(id). */
  async function lookupTenantId(userId, op) {
    const rows = await call(op, "GET", `/rest/v1/user_profiles?id=${eq(userId)}&select=id,tenant_id&limit=2`);
    if (!Array.isArray(rows)) fail(`${op}: bentuk respons user_profiles tidak dikenal`);
    if (rows.length === 0) return null;
    if (rows.length > 1) fail(`${op}: user_profiles ambigu`);
    const t = rows[0].tenant_id;
    if (t === null || t === undefined) return null;
    return assertUuid(t, op);
  }

  async function findUserByEmail(email) {
    assertIdentity(email, "findUserByEmail");
    return lookupIdentity("findUserByEmail");
  }

  async function removeIdentity(op) {
    const user = await lookupIdentity(op);
    if (!user) return { deleted: false, userId: null, tenantId: null };
    const tenantId = await lookupTenantId(user.id, op);
    if (tenantId) {
      // Tenant dibagi dengan pengguna lain = relasi tidak sesuai asumsi QA: jangan menebak.
      const members = await call(op, "GET", `/rest/v1/user_profiles?tenant_id=${eq(tenantId)}&select=id&limit=3`);
      if (!Array.isArray(members)) fail(`${op}: bentuk respons anggota tenant tidak dikenal`);
      if (members.some((r) => r?.id !== user.id)) fail(`${op}: tenant identitas QA punya anggota lain (UNKNOWN), reset dibatalkan`);
      const del = { Prefer: "return=representation" };
      const subs = await call(op, "DELETE", `/rest/v1/prompter_subscriptions?tenant_id=${eq(tenantId)}&select=tenant_id`, del);
      if (!Array.isArray(subs) || subs.length > 1) fail(`${op}: hasil hapus langganan tidak sesuai`);
      const tn = await call(op, "DELETE", `/rest/v1/tenants?id=${eq(tenantId)}&select=id`, del);
      if (!Array.isArray(tn) || tn.length > 1) fail(`${op}: hasil hapus tenant tidak sesuai`);
    }
    await call(op, "DELETE", `/auth/v1/admin/users/${assertUuid(user.id, op)}`);
    return { deleted: true, userId: user.id, tenantId };
  }

  async function deleteUser(id) {
    assertUuid(id, "deleteUser");
    const user = await lookupIdentity("deleteUser");
    if (!user || user.id !== id) fail("deleteUser: ditolak, id bukan identitas QA terkunci");
    await removeIdentity("deleteUser");
  }

  async function resetIdentity() {
    return removeIdentity("resetIdentity");
  }

  // Hanya BACA. Sumber: public.prompter_subscriptions (current_period_end dipetakan ke trial_ends_at; tidak ada kolom trial_ends_at).
  async function getTrial(email) {
    assertIdentity(email, "getTrial");
    const user = await lookupIdentity("getTrial");
    if (!user) return null;
    const tenantId = await lookupTenantId(user.id, "getTrial");
    if (!tenantId) return null;
    const rows = await call("getTrial", "GET", `/rest/v1/prompter_subscriptions?tenant_id=${eq(tenantId)}&select=status,plan,current_period_end&limit=2`);
    if (!Array.isArray(rows)) fail("getTrial: bentuk respons tidak dikenal");
    if (rows.length === 0) return null;
    if (rows.length > 1) fail("getTrial: langganan ambigu");
    const r = rows[0];
    return { status: String(r.status), plan: String(r.plan), trial_ends_at: String(r.current_period_end) };
  }

  const client = {
    url,
    findUserByEmail,
    deleteUser,
    getTrial,
    resetIdentity,
    toJSON: () => ({ url, project: "qa" }),
  };
  return Object.freeze(client);
}
