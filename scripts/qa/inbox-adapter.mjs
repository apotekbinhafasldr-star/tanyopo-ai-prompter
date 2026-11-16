// QA-2: adapter kotak masuk tetap (inbox) untuk email nyata.
// Penyedia yang didukung: "resend" (Resend Receiving API, hanya baca). Jenis lain: NOT_IMPLEMENTED (fail-closed).
// Aman secara desain: tanpa jaringan sendiri (fetch DISUNTIK), token hanya lewat parameter dan tidak pernah dicetak,
// tidak mengikuti tautan, tidak mengeksekusi HTML (html hanya dikembalikan sebagai string), tidak menghapus apa pun.
// Tidak ada pengiriman email di sini; hanya GET ke API penerimaan.

import { redact } from "./real-e2e-guard.mjs";

/**
 * @typedef {Object} InboxMessage
 * @property {string} subject
 * @property {string} html
 * @property {Record<string, string>} headers nama header huruf kecil (mis. "authentication-results", "received-spf", "dkim-signature")
 */

/**
 * @typedef {Object} WaitOptions
 * @property {string} subjectIncludes
 * @property {number} timeoutMs
 */

/**
 * @typedef {Object} InboxAdapter
 * @property {(options?: { address?: string }) => Promise<void>} clear Menandai kotak masuk QA "bersih": pesan yang sudah ada diabaikan selamanya. TIDAK menghapus pesan.
 * @property {(options: WaitOptions) => Promise<InboxMessage>} waitForMessage Menunggu email yang tiba SETELAH clear().
 */

/**
 * @typedef {Object} InboxDeps
 * @property {typeof fetch} fetch wajib; disuntik (tes memakai fetch palsu)
 * @property {string} token token baca penyedia (dibaca pemanggil dari env QA_INBOX_READ_TOKEN)
 * @property {string} address alamat kotak masuk QA tetap, wajib di domain yang diizinkan
 * @property {number} [maxAttempts] maksimum polling per waitForMessage (bawaan 20, batas keras 60)
 * @property {number} [initialDelayMs] bawaan 1000
 * @property {number} [maxDelayMs] bawaan 8000
 * @property {(ms: number) => Promise<void>} [sleep]
 * @property {() => number} [now]
 */

export const NOT_IMPLEMENTED_MESSAGE = "NOT_IMPLEMENTED: provider not chosen";
export const SUPPORTED_KINDS = ["resend"];
// Salinan konstanta sender-lock (#151, scripts/qa/real-e2e-guard.mjs: QA_SENDER_DOMAIN). Setelah #151 merge, impor dari sana.
// Tes memastikan nilainya sama dengan di branch #151. Domain TIDAK dapat diperluas lewat deps.
export const QA_SENDER_DOMAIN = "qa.tanyopo.com";
export const DEFAULT_ALLOWED_DOMAINS = Object.freeze([QA_SENDER_DOMAIN]);

const API_BASE = "https://api.resend.com";
const MAX_ATTEMPTS_HARD_CAP = 60;
const MAX_TIMEOUT_MS = 600_000;
const MAX_CLEAR_PAGES = 5;
const PAGE_LIMIT = 100;
const REQUEST_TIMEOUT_MS = 10_000;
// Sama dengan LOCKED_ADDRESS_RE di #151: ASCII ketat, tanpa '+', '%', spasi, display-name; domain persis qa.tanyopo.com.
// Sengaja TANPA toLowerCase()/flag u sebelum uji: "K" (Kelvin) akan menjadi "k" dan lolos sebagai homoglyph.
const LOCKED_ADDRESS_RE = /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*@qa\.tanyopo\.com$/i;
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** @param {string} text @param {string} token */
function scrub(text, token) {
  let out = redact(String(text), { QA_INBOX_READ_TOKEN: token });
  // Lapis kedua: potongan Bearer apa pun.
  out = out.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
  return out;
}

/** @param {string} value @returns {string | null} alamat huruf kecil bila valid */
function normalizeAddress(value) {
  if (typeof value !== "string" || value.length > 254) return null;
  const at = value.indexOf("@");
  if (at < 1 || at > 64) return null;
  return LOCKED_ADDRESS_RE.test(value) ? value.toLowerCase() : null;
}

/** @param {unknown} entry @returns {string | null} */
function extractAddress(entry) {
  if (typeof entry !== "string") return null;
  const m = /<([^<>]+)>/.exec(entry);
  return normalizeAddress(m ? m[1] : entry);
}

/** @param {unknown} raw @returns {Record<string, string>} */
function normalizeHeaders(raw) {
  /** @type {Record<string, string>} */
  const out = {};
  if (Array.isArray(raw)) {
    for (const h of raw) {
      if (h && typeof h.name === "string" && h.value != null) out[h.name.toLowerCase()] = String(h.value);
    }
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) {
      if (v != null) out[k.toLowerCase()] = Array.isArray(v) ? v.join("\n") : String(v);
    }
  }
  return out;
}

/**
 * @param {string} kind jenis penyedia; hanya "resend" yang didukung
 * @param {InboxDeps} [deps]
 * @returns {InboxAdapter}
 */
export function createInboxAdapter(kind, deps) {
  // Fail-closed: jenis tak dikenal (termasuk bukan string) = NOT_IMPLEMENTED.
  if (typeof kind !== "string" || !SUPPORTED_KINDS.includes(kind)) throw new Error(NOT_IMPLEMENTED_MESSAGE);

  const d = deps ?? /** @type {Partial<InboxDeps>} */ ({});
  const missing = [];
  if (typeof d.fetch !== "function") missing.push("fetch");
  if (typeof d.token !== "string" || d.token.trim() === "") missing.push("token");
  if (typeof d.address !== "string" || d.address.trim() === "") missing.push("address");
  if (missing.length > 0) throw new Error(`INBOX_MISCONFIGURED: parameter wajib kosong (${missing.join(", ")})`);

  const token = /** @type {string} */ (d.token);
  const doFetch = /** @type {typeof fetch} */ (d.fetch);
  // Hanya alamat tunggal @qa.tanyopo.com (tanpa plus-address/subdomain/homoglyph); selain itu ditolak.
  const address = normalizeAddress(/** @type {string} */ (d.address));
  if (address === null) throw new Error("INBOX_REFUSED: address bukan alamat tunggal QA @qa.tanyopo.com");

  const maxAttempts = Math.min(Math.max(Math.trunc(d.maxAttempts ?? 20), 1), MAX_ATTEMPTS_HARD_CAP);
  const initialDelayMs = Math.max(Math.trunc(d.initialDelayMs ?? 1000), 0);
  const maxDelayMs = Math.max(Math.trunc(d.maxDelayMs ?? 8000), initialDelayMs);
  const sleep = d.sleep ?? ((/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = d.now ?? (() => Date.now());

  /** @type {{ ids: Set<string>, maxCreated: number } | null} */
  let baseline = null;

  /**
   * GET JSON ke API penerimaan. Pesan error tidak memuat token atau isi respons.
   * @param {string} path
   * @returns {Promise<{ retriable: boolean, status: number, json: any }>}
   */
  async function get(path) {
    /** @type {RequestInit} */
    const init = {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      redirect: "error", // tidak mengikuti pengalihan
    };
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      init.signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    }
    let res;
    try {
      res = await doFetch(`${API_BASE}${path}`, init);
    } catch (err) {
      const msg = scrub(err instanceof Error ? err.message : String(err), token).slice(0, 120);
      return { retriable: true, status: 0, json: { _error: msg } };
    }
    const status = typeof res?.status === "number" ? res.status : 0;
    if (status === 401 || status === 403) throw new Error(`INBOX_AUTH_FAILED: penyedia menolak token (HTTP ${status})`);
    if (status === 429 || status >= 500) return { retriable: true, status, json: null };
    if (!res.ok) throw new Error(`INBOX_REQUEST_FAILED: HTTP ${status}`);
    let json;
    try {
      json = await res.json();
    } catch {
      throw new Error("INBOX_BAD_RESPONSE: respons bukan JSON");
    }
    return { retriable: false, status, json };
  }

  /**
   * Daftar pesan masuk untuk alamat QA saja (disaring di sisi klien).
   * @param {number} pages
   * @returns {Promise<{ ok: boolean, items: Array<{ id: string, subject: string, created: number }> }>}
   */
  async function listForAddress(pages) {
    const items = [];
    let after = null;
    for (let page = 0; page < pages; page++) {
      const q = `?limit=${PAGE_LIMIT}${after ? `&after=${encodeURIComponent(after)}` : ""}`;
      const r = await get(`/emails/receiving${q}`);
      if (r.retriable) return { ok: false, items };
      const data = Array.isArray(r.json?.data) ? r.json.data : null;
      if (data === null) throw new Error("INBOX_BAD_RESPONSE: bentuk daftar tidak dikenal");
      for (const m of data) {
        if (!m || typeof m.id !== "string" || !ID_RE.test(m.id)) continue;
        const to = Array.isArray(m.to) ? m.to : [];
        if (!to.some((t) => extractAddress(t) === address)) continue; // pesan alamat lain: tidak disentuh
        const created = Date.parse(m.created_at);
        items.push({ id: m.id, subject: typeof m.subject === "string" ? m.subject : "", created: Number.isFinite(created) ? created : 0 });
      }
      if (r.json?.has_more === true && data.length > 0 && typeof data[data.length - 1]?.id === "string") {
        after = data[data.length - 1].id;
      } else {
        break;
      }
    }
    return { ok: true, items };
  }

  return {
    async clear(options) {
      if (options && options.address !== undefined) {
        const requested = normalizeAddress(options.address);
        if (requested === null || requested !== address) {
          throw new Error("INBOX_REFUSED: clear hanya boleh pada alamat QA yang dikonfigurasi");
        }
      }
      const listed = await listForAddress(MAX_CLEAR_PAGES);
      if (!listed.ok) throw new Error("INBOX_UNAVAILABLE: penyedia sementara tidak tersedia, clear gagal");
      baseline = {
        ids: new Set(listed.items.map((i) => i.id)),
        maxCreated: listed.items.reduce((acc, i) => Math.max(acc, i.created), 0),
      };
    },

    async waitForMessage(options) {
      if (baseline === null) throw new Error("INBOX_NOT_CLEARED: panggil clear() sebelum waitForMessage");
      const needle = options?.subjectIncludes;
      const timeoutMs = options?.timeoutMs;
      if (typeof needle !== "string" || needle.trim() === "") throw new Error("INBOX_BAD_OPTIONS: subjectIncludes wajib");
      if (!Number.isInteger(timeoutMs) || /** @type {number} */ (timeoutMs) < 1 || /** @type {number} */ (timeoutMs) > MAX_TIMEOUT_MS) {
        throw new Error(`INBOX_BAD_OPTIONS: timeoutMs harus bilangan bulat 1..${MAX_TIMEOUT_MS}`);
      }
      const lowered = needle.toLowerCase();
      const started = now();
      const base = baseline;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const listed = await listForAddress(1);
        if (listed.ok) {
          const fresh = listed.items
            .filter((i) => !base.ids.has(i.id) && i.created >= base.maxCreated && i.subject.toLowerCase().includes(lowered))
            .sort((a, b) => b.created - a.created);
          if (fresh.length > 0) {
            const r = await get(`/emails/receiving/${encodeURIComponent(fresh[0].id)}`);
            if (!r.retriable) {
              const full = r.json;
              if (!full || typeof full !== "object") throw new Error("INBOX_BAD_RESPONSE: detail pesan tidak valid");
              return {
                subject: typeof full.subject === "string" ? full.subject : fresh[0].subject,
                html: typeof full.html === "string" ? full.html : "",
                headers: normalizeHeaders(full.headers),
              };
            }
          }
        }
        if (attempt === maxAttempts) break;
        const delay = Math.min(maxDelayMs, initialDelayMs * 2 ** (attempt - 1));
        if (now() - started + delay >= timeoutMs) break;
        await sleep(delay);
      }
      throw new Error(`INBOX_TIMEOUT: tidak ada email baru dengan subjek yang diminta (batas ${maxAttempts} percobaan / ${timeoutMs} ms)`);
    },
  };
}
