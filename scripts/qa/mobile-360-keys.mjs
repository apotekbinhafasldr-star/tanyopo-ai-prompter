// Logika kunci temuan dan baseline untuk harness 360px. Tanpa dependensi (hanya node:crypto) agar bisa diuji unit.
import { createHash } from "node:crypto";

/** Kunci yang TIDAK PERNAH boleh diterima baseline: halaman tidak termuat, status bukan 2xx, pengalihan tak terduga, sesi demo asli gagal. */
export const isFatalKey = (key) => key === "load" || key.startsWith("status:") || key.startsWith("redirect:") || key.startsWith("demo-session:");

const MAX_SELECTOR = 140;

/**
 * Selector axe -> bagian kunci yang stabil antar-lari. Id dinamis React (`#:r1:`, `#_R_1_`) dinormalkan; selector
 * panjang dipotong dan diberi hash dari selector penuh. Batas: indeks `:nth-child(n)` dipertahankan (stabil selama DOM
 * sama), jadi perubahan urutan elemen akan tampak sebagai temuan baru dan lama yang "usang".
 */
export function normalizeSelector(sel) {
  const s = String(sel).replace(/#:[a-z0-9]+:/gi, "#:id:").replace(/#_R_[A-Za-z0-9_]+_/g, "#_R_id_").replace(/\s+/g, " ").trim();
  if (s.length <= MAX_SELECTOR) return s;
  return `${s.slice(0, 100)}~${createHash("sha1").update(s).digest("hex").slice(0, 8)}`;
}

/** Satu kunci per NODE pelanggaran serious/critical: `axe:<aturan>:<selector>`. */
export function axeKeys(axeViolations) {
  const keys = [];
  for (const v of axeViolations ?? []) {
    if (v.impact !== "serious" && v.impact !== "critical") continue;
    const targets = v.targets?.length ? v.targets : [v.sample ?? "(tanpa selector)"];
    for (const t of targets) keys.push(`axe:${v.id}:${normalizeSelector(t)}`);
  }
  return keys;
}

/** Kunci temuan satu halaman. `load`/`status:*` bersifat fatal (lihat isFatalKey). */
export function keysOf(r, expectedRedirects = {}) {
  if (r.sessionProblems?.length) return r.sessionProblems.map((p) => `demo-session:${p}`);
  if (r.error) return ["load"];
  const k = [];
  if (typeof r.status === "number" && (r.status < 200 || r.status >= 300)) k.push(`status:${r.status}`);
  // Pengalihan hanya sah bila terdaftar eksplisit di peta (rute diminta -> tujuan); selain itu FATAL.
  if (r.requestedPath && r.finalPath && r.requestedPath !== r.finalPath && expectedRedirects[r.requestedPath] !== r.finalPath) {
    k.push(`redirect:${r.finalPath}`);
  }
  if (r.innerWidth !== 360) k.push("viewport");
  if (r.overflowX > 0) k.push("overflowX");
  for (const t of r.small ?? []) k.push(`target<44:${t.el}:${t.name}`);
  if (r.unnamedButtons) k.push("unnamedButtons");
  if (r.inputsNoLabel) k.push("inputsNoLabel");
  k.push(...axeKeys(r.axe));
  return [...new Set(k)];
}

/** Menolak baseline yang mencoba menerima kunci fatal atau tanpa alasan. */
export function validateBaseline(baseline) {
  const errors = [];
  for (const [label, entries] of Object.entries(baseline?.accepted ?? {})) {
    for (const e of entries) {
      if (isFatalKey(e.key)) errors.push(`${label}: kunci "${e.key}" tidak boleh di-baseline (halaman wajib harus termuat)`);
      if (!e.reason || e.reason.trim().length < 10) errors.push(`${label}: entri "${e.key}" tanpa alasan`);
    }
  }
  return errors;
}

/** Fatal selalu baru; selain itu baru bila tidak ada di baseline. */
export function classify(keys, acceptedEntries) {
  const accepted = new Set((acceptedEntries ?? []).map((e) => e.key));
  return {
    fresh: keys.filter((k) => isFatalKey(k) || !accepted.has(k)),
    stale: [...accepted].filter((k) => !keys.includes(k)),
  };
}

/** Atribut keamanan cookie sesi demo dari respons ASLI /api/demo/start. Mengembalikan daftar yang hilang (kosong = lengkap). */
export function checkSessionCookieAttrs(setCookie) {
  const sc = String(setCookie ?? "");
  if (!sc) return ["cookie-tidak-ada"];
  const missing = [];
  if (!/;\s*secure\b/i.test(sc)) missing.push("Secure");
  if (!/;\s*httponly\b/i.test(sc)) missing.push("HttpOnly");
  if (!/;\s*samesite=lax\b/i.test(sc)) missing.push("SameSite=Lax");
  if (!/;\s*path=\/(;|$)/i.test(sc)) missing.push("Path=/");
  if (!/;\s*(max-age=\d+|expires=)/i.test(sc)) missing.push("Max-Age/Expires");
  return missing;
}
