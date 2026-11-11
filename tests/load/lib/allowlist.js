// Logika allowlist untuk skrip beban k6. SENGAJA murni: tanpa API k6, tanpa API Node, tanpa dependensi,
// supaya bisa diimpor oleh k6 (modul ES lokal) DAN dites oleh Vitest (tests/unit/load/allowlist.test.ts).
//
// Prinsip: tolak secara default. Target hanya lolos bila (1) BASE_URL berbentuk https://<host> polos,
// (2) host cocok dengan salah satu pola di allowlist.txt, dan (3) tidak cocok dengan pola larangan ("!").

/** Kata penanda yang wajib ada pada tiap pola allow: mencegah situs produksi masuk allowlist karena salah ketik. */
export const REQUIRED_MARKERS = ["sandbox", "staging", "loadtest"];

/** Jalur ringan yang boleh diminta. Hanya GET, tanpa query, tanpa kredensial. */
export const SAFE_PATHS = ["/api/health", "/", "/login", "/privacy", "/terms"];

/** Batas keras (bukan sekadar default). Nilai di atas ini ditolak, bukan dipotong. */
export const LIMITS = { defaultVus: 2, maxVus: 10, defaultDurationSeconds: 30, maxDurationSeconds: 120 };

const PATTERN_RE = /^[a-z0-9*-]+\.netlify\.app$/;
const HOST_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

/**
 * @param {string} pattern pola host, contoh "deploy-preview-*--linoe-sandbox.netlify.app"
 * @param {boolean} isAllow true untuk pola allow (kena syarat penanda), false untuk pola larangan
 * @returns {string} pesan galat, atau "" bila pola valid
 */
function patternProblem(pattern, isAllow) {
  if (!PATTERN_RE.test(pattern)) {
    return 'pola harus huruf kecil, hanya a-z 0-9 - * dan berakhir ".netlify.app" (satu label situs saja)';
  }
  const label = pattern.slice(0, -".netlify.app".length);
  const literal = label.replace(/\*/g, "");
  if (literal.length < 10) return "pola terlalu longgar (minimal 10 karakter non-bintang; pakai nama situs milik sendiri)";
  if ((label.match(/\*/g) || []).length > 3) return "terlalu banyak bintang (maksimal 3)";
  if (isAllow && !REQUIRED_MARKERS.some((m) => literal.includes(m))) {
    return "pola allow wajib memuat salah satu penanda: " + REQUIRED_MARKERS.join(", ");
  }
  return "";
}

/**
 * Parse isi allowlist.txt. Baris kosong dan baris berawalan "#" diabaikan. Awalan "!" = larangan (menang atas allow).
 * Melempar Error bila ada baris tidak valid (gagal keras, bukan diabaikan diam-diam).
 * @param {string} text
 * @returns {{ allow: string[], deny: string[] }}
 */
export function parseAllowlist(text) {
  /** @type {string[]} */
  const allow = [];
  /** @type {string[]} */
  const deny = [];
  const lines = String(text == null ? "" : text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "" || line.charAt(0) === "#") continue;
    const isDeny = line.charAt(0) === "!";
    const pattern = (isDeny ? line.slice(1) : line).trim();
    const problem = patternProblem(pattern, !isDeny);
    if (problem) throw new Error("allowlist baris " + (i + 1) + " tidak valid: " + problem);
    (isDeny ? deny : allow).push(pattern);
  }
  return { allow, deny };
}

/**
 * Cocokkan host utuh dengan pola. "*" hanya mewakili huruf/angka/tanda hubung (tidak pernah titik),
 * sehingga tidak bisa melompat ke subdomain atau domain lain.
 * @param {string} host
 * @param {string} pattern
 * @returns {boolean}
 */
export function hostMatches(host, pattern) {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\-]/g, "\\$&"))
    .join("[a-z0-9-]*");
  return new RegExp("^" + source + "$").test(host);
}

/**
 * Validasi BASE_URL terhadap isi allowlist. Parser sengaja ketat (regex, bukan URL()) supaya tidak ada
 * selisih tafsir: tanpa userinfo, port, path, query, fragment; huruf besar-kecil dinormalkan; hanya https.
 * @param {string | undefined} rawBaseUrl
 * @param {string} allowlistText
 * @returns {{ ok: true, origin: string, host: string } | { ok: false, reason: string }}
 */
export function validateBaseUrl(rawBaseUrl, allowlistText) {
  if (typeof rawBaseUrl !== "string" || rawBaseUrl.trim() === "") {
    return { ok: false, reason: "BASE_URL wajib diisi" };
  }
  const raw = rawBaseUrl.trim().toLowerCase();
  const m = /^https:\/\/([^/?#@:\\\s]+)\/?$/.exec(raw);
  if (!m) {
    return { ok: false, reason: "BASE_URL harus berbentuk https://<host> saja (tanpa http, userinfo, port, path, query, fragment)" };
  }
  const host = m[1];
  if (host.length > 253 || !HOST_RE.test(host) || /^[0-9.]+$/.test(host)) {
    return { ok: false, reason: "host tidak valid atau berupa alamat IP" };
  }
  /** @type {{ allow: string[], deny: string[] }} */
  let list;
  try {
    list = parseAllowlist(allowlistText);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  if (list.allow.length === 0) {
    return { ok: false, reason: "allowlist kosong: isi tests/load/allowlist.txt dengan host sandbox yang disetujui Founder" };
  }
  if (list.deny.some((p) => hostMatches(host, p))) {
    return { ok: false, reason: "host " + host + " ada di daftar larangan (!)" };
  }
  if (!list.allow.some((p) => hostMatches(host, p))) {
    return { ok: false, reason: "host " + host + " tidak ada di allowlist" };
  }
  return { ok: true, origin: "https://" + host, host };
}

/**
 * Baca batas beban dari variabel lingkungan (string). Nilai kosong = default. Di luar batas = galat.
 * @param {{ VUS?: string, DURATION_SECONDS?: string } | undefined} env
 * @returns {{ vus: number, durationSeconds: number }}
 */
export function parseLimits(env) {
  /**
   * @param {string | undefined} v
   * @param {string} name
   * @param {number} dflt
   * @param {number} max
   * @returns {number}
   */
  const read = (v, name, dflt, max) => {
    if (v === undefined || String(v).trim() === "") return dflt;
    const s = String(v).trim();
    if (!/^[0-9]+$/.test(s)) throw new Error(name + " harus bilangan bulat positif");
    const n = Number(s);
    if (n < 1 || n > max) throw new Error(name + " harus antara 1 dan " + max + " (batas keras)");
    return n;
  };
  const e = env || {};
  return {
    vus: read(e.VUS, "VUS", LIMITS.defaultVus, LIMITS.maxVus),
    durationSeconds: read(e.DURATION_SECONDS, "DURATION_SECONDS", LIMITS.defaultDurationSeconds, LIMITS.maxDurationSeconds),
  };
}
