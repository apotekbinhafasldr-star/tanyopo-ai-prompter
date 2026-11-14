import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { assertRealQaEnv, redact } from "./real-e2e-guard.mjs";
import { createInboxAdapter } from "./inbox-adapter.mjs";

// QA-2 / jalur B (REAL email E2E). DESAIN SAJA: tidak aktif, tidak mengirim email, tidak membaca secret produksi.
//  * Selalu menjalankan assertRealQaEnv lebih dulu (fail-closed).
//  * Tanpa QA2_ACTIVATED=true: mencetak rencana langkah lalu keluar dengan kode 3.
//  * Tidak boleh berjalan di produksi (Netlify/Vercel/NODE_ENV=production ditolak).

export const PLAN = [
  "1. Reset pengguna proyek QA lewat Admin API (HANYA proyek QA)",
  "2. Kosongkan kotak masuk tetap",
  "3. Signup lewat /register pada aplikasi lokal yang menunjuk proyek QA",
  "4. Tunggu email nyata (Resend SMTP) masuk ke kotak masuk tetap",
  "5. Verifikasi header Authentication-Results / SPF / DKIM",
  "6. Ikuti tautan konfirmasi",
  "7. Onboarding 8 langkah",
  "8. Dashboard",
  "9. Trial 14 hari",
  "10. Pendaftaran duplikat ditolak",
  "11. Bersihkan (cleanup) data proyek QA",
];

/**
 * @param {Record<string, string | undefined>} env
 */
function assertNotProduction(env) {
  if (env.NODE_ENV === "production" || env.NETLIFY || env.VERCEL) {
    throw new Error("QA-2 GUARD REFUSED: tidak boleh berjalan di lingkungan produksi/hosting");
  }
}

/**
 * @param {string[]} argv
 */
async function main(argv) {
  const env = process.env;
  try {
    assertNotProduction(env);
    assertRealQaEnv(env);
    assertMaxEmailsPerRun(env);
  } catch (err) {
    console.error(redact(String(err instanceof Error ? err.message : err), env));
    process.exit(2);
  }
  if (argv.includes("--guard-only")) {
    console.log("QA-2 guard: OK (hanya proyek QA, tanpa kredensial produksi)");
    return;
  }
  console.log("QA-2 rencana langkah:");
  for (const line of PLAN) console.log(`  ${line}`);
  if (env.QA2_ACTIVATED !== "true") {
    console.error("QA-2 NOT ACTIVATED: inbox adapter / infrastructure not provisioned");
    process.exit(3);
  }
  // Walau diaktifkan, adapter belum ada: melempar NOT_IMPLEMENTED.
  try {
    createInboxAdapter("unset");
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(3);
  }
  // Fail-closed: driver browser dan admin client nyata belum ada; runRealE2E hanya dipanggil dengan dependensi suntikan.
  console.error("NOT_IMPLEMENTED: browser driver / admin client belum diprovisi");
  process.exit(3);
}

// ---------------------------------------------------------------------------------------------------------------------
// Orkestrasi (murni terhadap dependensi suntikan; tidak ada fetch/jaringan/berkas di sini)
// ---------------------------------------------------------------------------------------------------------------------

export const EXIT = Object.freeze({ PASS: 0, FAIL: 1, REFUSED: 2, NOT_ACTIVATED: 3 });
export const TRIAL_DAYS = 14;
export const MAX_REDIRECTS = 5;
const DAY_MS = 86_400_000;
const PRODUCTION_HOST_MARKERS = ["tanyopo.com", "netlify.app", "netlify.com", "vercel.app", "vercel.com"];
const CONFIRM_PATHS = ["/auth/confirm", "/auth/v1/verify"];

/**
 * Batas biaya fail-closed: QA_MAX_EMAILS_PER_RUN WAJIB ada dan persis "1" (tanpa default diam-diam). Murni.
 * @param {Record<string, string | undefined>} env
 * @returns {number}
 */
export function assertMaxEmailsPerRun(env) {
  if (env.QA_MAX_EMAILS_PER_RUN !== "1") throw new Error('QA_MAX_EMAILS_PER_RUN wajib ada dan persis "1"');
  return 1;
}

/**
 * Anggaran email: setiap pemanggilan signup dihitung; pemanggilan melebihi batas = gagal (fail-closed).
 * @param {number} max
 */
export function createEmailBudget(max) {
  let used = 0;
  return {
    get used() {
      return used;
    },
    /** @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
    async spend(fn) {
      if (used + 1 > max) throw new Error(`batas email per run terlampaui (maks ${max})`);
      used += 1;
      return fn();
    },
  };
}

/**
 * Menyelesaikan dan memvalidasi satu header Location terhadap URL saat ini. Murni; melempar bila ditolak.
 * @param {string} location
 * @param {string} currentUrl
 * @param {readonly string[]} allowedOrigins
 * @returns {string} URL absolut berikutnya
 */
export function resolveRedirect(location, currentUrl, allowedOrigins) {
  let u;
  try {
    u = new URL(location, currentUrl); // relatif diselesaikan terhadap URL saat ini
  } catch {
    throw new Error("redirect ditolak: Location tidak valid");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`redirect ditolak: skema ${u.protocol} tidak diizinkan`);
  if (u.username !== "" || u.password !== "") throw new Error("redirect ditolak: memuat userinfo");
  if (PRODUCTION_HOST_MARKERS.some((m) => u.hostname === m || u.hostname.endsWith(`.${m}`))) {
    throw new Error(`redirect ditolak: host produksi/hosting ${u.hostname}`);
  }
  if (!allowedOrigins.includes(u.origin)) throw new Error(`redirect ditolak: host ${u.hostname} di luar aplikasi uji/Supabase QA`);
  return u.href;
}

/**
 * Mengikuti tautan per-hop: validasi SEBELUM setiap request; driver hanya melakukan satu request tanpa auto-redirect.
 * @param {string} startUrl sudah divalidasi
 * @param {(url: string) => Promise<{status: number, location?: string}>} fetchHop
 * @param {readonly string[]} allowedOrigins
 * @returns {Promise<{finalUrl: string, hops: number}>}
 */
export async function followRedirects(startUrl, fetchHop, allowedOrigins) {
  let current = resolveRedirect(startUrl, startUrl, allowedOrigins);
  const visited = new Set([current.split("#")[0]]);
  for (let redirects = 0; ; redirects += 1) {
    const r = await fetchHop(current);
    if (r.status >= 300 && r.status < 400) {
      if (!r.location) throw new Error(`redirect ditolak: status ${r.status} tanpa Location`);
      if (redirects >= MAX_REDIRECTS) throw new Error(`redirect melebihi batas (${MAX_REDIRECTS})`);
      const next = resolveRedirect(r.location, current, allowedOrigins); // validasi sebelum hop berikutnya
      const key = next.split("#")[0];
      if (visited.has(key)) throw new Error("redirect ditolak: loop terdeteksi");
      visited.add(key);
      current = next;
      continue;
    }
    if (r.status < 200 || r.status >= 300) throw new Error(`hop berakhir dengan status ${r.status}`);
    return { finalUrl: current, hops: redirects };
  }
}

/**
 * Identitas QA tetap: dari QA_INBOX_ADDRESS, tanpa plus-addressing. Murni.
 * @param {string | undefined} address
 * @returns {string} alamat huruf kecil
 */
export function assertFixedIdentity(address) {
  if (typeof address !== "string" || address.trim() === "") throw new Error("QA_INBOX_ADDRESS wajib diisi");
  const email = address.trim();
  if (email.includes("+")) throw new Error("QA_INBOX_ADDRESS tidak boleh memakai plus-addressing (identitas QA harus tetap)");
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error("QA_INBOX_ADDRESS bukan alamat email valid");
  return email.toLowerCase();
}

/**
 * @param {string} urlText
 * @returns {URL}
 */
function parseUrl(urlText) {
  try {
    return new URL(urlText);
  } catch {
    throw new Error("URL tidak valid");
  }
}

/**
 * Asal (origin) yang diizinkan untuk tautan: aplikasi uji dan proyek Supabase QA. Menolak aplikasi uji yang menunjuk host produksi.
 * @param {string} appUrl
 * @param {string} qaSupabaseUrl
 * @returns {string[]}
 */
export function buildAllowedOrigins(appUrl, qaSupabaseUrl) {
  const app = parseUrl(appUrl);
  const supa = parseUrl(qaSupabaseUrl);
  const local = app.hostname === "localhost" || app.hostname === "127.0.0.1";
  if (!(app.protocol === "https:" || (local && app.protocol === "http:"))) throw new Error("URL aplikasi uji harus https (atau http untuk localhost)");
  if (PRODUCTION_HOST_MARKERS.some((m) => app.hostname === m || app.hostname.endsWith(`.${m}`))) {
    throw new Error("URL aplikasi uji menunjuk host produksi/hosting");
  }
  if (supa.protocol !== "https:") throw new Error("URL Supabase QA harus https");
  return [...new Set([app.origin, supa.origin])];
}

/**
 * Semua tautan konfirmasi (/auth/confirm atau /auth/v1/verify) dalam isi email. Murni.
 * @param {string} html
 * @returns {string[]}
 */
export function extractConfirmationLinks(html) {
  const blob = String(html).replaceAll("&amp;", "&");
  const found = blob.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  const out = [];
  for (const raw of found) {
    let u;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    if (CONFIRM_PATHS.some((p) => u.pathname === p)) out.push(raw);
  }
  return [...new Set(out)];
}

/**
 * Validasi tautan sebelum diikuti: asal harus aplikasi uji atau Supabase QA; tanpa userinfo; parameter redirect_to/next
 * tidak boleh mengarah ke host lain. Murni; melempar bila ditolak (pesan tanpa token).
 * @param {string} link
 * @param {readonly string[]} allowedOrigins
 */
export function validateConfirmationLink(link, allowedOrigins) {
  const u = parseUrl(link);
  if (u.username !== "" || u.password !== "") throw new Error("tautan ditolak: memuat userinfo");
  if (!allowedOrigins.includes(u.origin)) throw new Error(`tautan ditolak: host ${u.hostname} bukan aplikasi uji/Supabase QA`);
  for (const key of ["redirect_to", "next", "redirect", "url"]) {
    const v = u.searchParams.get(key);
    if (v === null || v === "") continue;
    if (v.startsWith("//") || v.startsWith("\\")) throw new Error("tautan ditolak: parameter redirect protokol-relatif");
    if (/^[a-z][a-z0-9+.-]*:/i.test(v)) {
      const t = parseUrl(v);
      if (!allowedOrigins.includes(t.origin)) throw new Error(`tautan ditolak: redirect ke host ${t.hostname}`);
    }
  }
}

/**
 * Parser Authentication-Results untuk SPF/DKIM/DMARC. Murni.
 * "pass" hanya bila minimal satu hasil pass dan tidak ada hasil gagal (fail/softfail/temperror/permerror).
 * @param {string | undefined} header
 * @returns {{ spf: string, dkim: string, dmarc: string }} nilai: "pass" | "fail" | "none" | hasil lain apa adanya
 */
export function parseAuthenticationResults(header) {
  const text = String(header ?? "").replace(/\([^)]*\)/g, " ");
  /** @type {Record<string, string[]>} */
  const seen = { spf: [], dkim: [], dmarc: [] };
  for (const m of text.matchAll(/(?:^|[\s;])(spf|dkim|dmarc)\s*=\s*([a-z]+)/gi)) seen[m[1].toLowerCase()].push(m[2].toLowerCase());
  const BAD = ["fail", "softfail", "temperror", "permerror"];
  /** @param {string[]} list */
  const agg = (list) => {
    if (list.length === 0) return "none";
    const bad = list.find((r) => BAD.includes(r));
    if (bad) return bad;
    return list.includes("pass") ? "pass" : list[0];
  };
  return { spf: agg(seen.spf), dkim: agg(seen.dkim), dmarc: agg(seen.dmarc) };
}

/**
 * @param {Record<string, string> | undefined} headers
 * @param {string} name
 * @returns {string | undefined}
 */
function headerValue(headers, name) {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key === undefined ? undefined : headers[key];
}

/** @param {{subject?: string, html?: string, headers?: Record<string,string>}} m */
const fingerprint = (m) => JSON.stringify([m.subject ?? "", m.html ?? "", m.headers ?? {}]);

/**
 * @param {string} text
 * @param {Record<string, string | undefined>} env
 * @param {string[]} extraSecrets
 */
function scrub(text, env, extraSecrets) {
  let out = redact(text, env);
  for (const s of extraSecrets) if (s) out = out.split(s).join("[REDACTED]");
  return out;
}

/**
 * @typedef {Object} RealE2EDeps
 * @property {Record<string, string | undefined>} env
 * @property {string} appUrl URL aplikasi uji (lokal) yang menunjuk proyek QA
 * @property {{ url: string, findUserByEmail: (email: string) => Promise<{id: string} | null>, deleteUser: (id: string) => Promise<void>, getTrial: (email: string) => Promise<{status: string, plan?: string, trial_ends_at: string} | null> }} adminClient hanya proyek QA
 * @property {import("./inbox-adapter.mjs").InboxAdapter} inbox
 * @property {{ signup: (o: object) => Promise<{outcome: string}>, fetchHop: (url: string) => Promise<{status: number, location?: string}>, signupDuplicate: (o: object) => Promise<{outcome: string}>, completeOnboarding: () => Promise<{completed: boolean}>, openDashboard: () => Promise<{status: number, url: string}>, openBilling: () => Promise<{status: number}> }} driver
 * @property {{ now: () => number }} clock
 * @property {{ allowedRefs?: readonly string[] }} [guardOptions]
 * @property {string} [password] bawaan: acak per run
 * @property {string} [subjectIncludes]
 * @property {number} [waitTimeoutMs]
 * @property {number} [probeTimeoutMs]
 * @property {number} [trialToleranceMs]
 */

/**
 * Orkestrasi 11 langkah PLAN. Tidak pernah melempar: hasil dikembalikan sebagai { exitCode, report, json }.
 * Tanpa QA2_ACTIVATED=true: tidak menyentuh dependensi apa pun (exit 3).
 * @param {RealE2EDeps} deps
 */
export async function runRealE2E(deps) {
  const env = deps.env;
  /** @param {string} result @param {number} exitCode @param {object} extra */
  const early = (result, exitCode, extra = {}) => {
    const report = { tool: "qa-2-real-e2e", result, ...extra };
    return { exitCode, report, json: scrub(JSON.stringify(report, null, 2), env, []) };
  };
  let email;
  let allowedOrigins;
  /** @type {number} */
  let maxEmails = 0;
  try {
    assertNotProduction(env);
    assertRealQaEnv(env, deps.guardOptions);
    email = assertFixedIdentity(env.QA_INBOX_ADDRESS);
    maxEmails = assertMaxEmailsPerRun(env);
    allowedOrigins = buildAllowedOrigins(deps.appUrl, String(env.QA_SUPABASE_URL));
  } catch (err) {
    return early("REFUSED", EXIT.REFUSED, { error: scrub(String(err instanceof Error ? err.message : err), env, []) });
  }
  if (env["QA2_ACTIVATED"] !== "true") {
    return early("NOT_ACTIVATED", EXIT.NOT_ACTIVATED, { plan: PLAN });
  }
  if (deps.adminClient.url !== env.QA_SUPABASE_URL) {
    return early("REFUSED", EXIT.REFUSED, { error: "adminClient.url bukan proyek QA (QA_SUPABASE_URL)" });
  }

  const { adminClient, inbox, driver, clock } = deps;
  const password = deps.password ?? `Qa-${randomBytes(9).toString("hex")}!`;
  const secretsSeen = [password];
  const budget = createEmailBudget(maxEmails);
  const startedAt = clock.now();
  /** @type {{n: number, name: string, ok: boolean, detail?: string}[]} */
  const steps = [];
  /** @type {Record<string, unknown>} */
  const facts = { identity: email, emailsExpected: maxEmails, emailsRequested: 0 };
  let failure = null;

  /** @param {number} n @param {() => Promise<string | void>} fn */
  const step = async (n, fn) => {
    const name = PLAN[n - 1];
    try {
      const detail = await fn();
      steps.push({ n, name, ok: true, ...(detail ? { detail } : {}) });
    } catch (err) {
      const detail = String(err instanceof Error ? err.message : err);
      steps.push({ n, name, ok: false, detail });
      throw err;
    }
  };

  try {
    await step(1, async () => {
      const user = await adminClient.findUserByEmail(email);
      if (user) await adminClient.deleteUser(user.id);
      if (await adminClient.findUserByEmail(email)) throw new Error("reset gagal: pengguna QA masih ada");
      return user ? "pengguna lama dihapus" : "tidak ada pengguna lama";
    });
    await step(2, async () => {
      await inbox.clear();
    });
    await step(3, async () => {
      // batas biaya: signup dihitung di orkestrator; panggilan kedua = gagal; tanpa retry
      const r = await budget.spend(() => driver.signup({ email, password, nama: "QA Linoe", namaUsaha: "QA Linoe Sandbox", fresh: false }));
      facts.emailsRequested = budget.used;
      if (r.outcome !== "check-email") throw new Error(`signup tidak menghasilkan pesan cek-email (outcome=${r.outcome})`);
    });
    /** @type {{subject?: string, html?: string, headers?: Record<string,string>}} */
    let message = {};
    await step(4, async () => {
      message = await inbox.waitForMessage({ subjectIncludes: deps.subjectIncludes ?? "", timeoutMs: deps.waitTimeoutMs ?? 120_000 });
      if (!message || typeof message.html !== "string") throw new Error("pesan inbox tidak valid");
    });
    await step(5, async () => {
      const header = headerValue(message.headers, "authentication-results");
      if (header === undefined) throw new Error("header Authentication-Results tidak ada");
      const r = parseAuthenticationResults(header);
      facts.authenticationResults = r;
      if (r.spf !== "pass" || r.dkim !== "pass" || r.dmarc !== "pass") {
        throw new Error(`autentikasi email gagal: spf=${r.spf} dkim=${r.dkim} dmarc=${r.dmarc}`);
      }
      return "spf=pass dkim=pass dmarc=pass";
    });
    await step(6, async () => {
      const links = extractConfirmationLinks(message.html ?? "");
      if (links.length === 0) throw new Error("tautan konfirmasi tidak ditemukan di email");
      secretsSeen.push(...links);
      for (const l of links) {
        validateConfirmationLink(l, allowedOrigins); // WAJIB sebelum diikuti; satu tautan asing menggagalkan run
        const th = new URL(l).searchParams.get("token_hash") ?? new URL(l).searchParams.get("token");
        if (th) secretsSeen.push(th);
      }
      const r = await followRedirects(links[0], (u) => driver.fetchHop(u), allowedOrigins);
      if (parseUrl(r.finalUrl).pathname !== "/onboarding") throw new Error("konfirmasi tidak berakhir di /onboarding");
      facts.redirectHops = r.hops;
      return `host=${new URL(links[0]).hostname} hops=${r.hops}`;
    });
    await step(7, async () => {
      const r = await driver.completeOnboarding();
      if (!r.completed) throw new Error("onboarding tidak selesai");
    });
    await step(8, async () => {
      const r = await driver.openDashboard();
      const u = parseUrl(r.url);
      if (r.status !== 200 || u.pathname !== "/dashboard" || !allowedOrigins.includes(u.origin)) throw new Error(`dashboard tidak terbuka (status=${r.status})`);
    });
    await step(9, async () => {
      const b = await driver.openBilling(); // trial dibuat saat akses pertama /billing
      if (b.status !== 200) throw new Error(`/billing status=${b.status}`);
      const t = await adminClient.getTrial(email);
      if (!t) throw new Error("langganan trial tidak ditemukan");
      if (String(t.status).toUpperCase() !== "TRIALING") throw new Error(`status trial salah: ${t.status}`);
      const ends = Date.parse(t.trial_ends_at);
      if (Number.isNaN(ends)) throw new Error("trial_ends_at tidak valid");
      const tolerance = deps.trialToleranceMs ?? DAY_MS;
      const expected = clock.now() + TRIAL_DAYS * DAY_MS;
      const diff = Math.abs(ends - expected);
      facts.trialDeviationMs = diff;
      if (diff > tolerance) throw new Error(`trial bukan ${TRIAL_DAYS} hari (selisih ${Math.round(diff / 3_600_000)} jam)`);
      return `trial ${TRIAL_DAYS} hari (selisih ${Math.round(diff / 60_000)} menit)`;
    });
    await step(10, async () => {
      // Bukan signup yang mengirim email: kontrak signupDuplicate = tanpa email; probe inbox di bawah memverifikasinya.
      const r = await driver.signupDuplicate({ email, password, nama: "QA Linoe", namaUsaha: "QA Linoe Sandbox" });
      if (r.outcome !== "duplicate") throw new Error(`pendaftaran duplikat tidak ditolak (outcome=${r.outcome})`);
      // Batas biaya: tidak boleh ada email tak terduga. Antarmuka inbox tidak punya hitungan; probe singkat dan bandingkan sidik jari.
      let extra = null;
      try {
        extra = await inbox.waitForMessage({ subjectIncludes: "", timeoutMs: deps.probeTimeoutMs ?? 5_000 });
      } catch {
        extra = null; // tidak ada pesan lain = yang diharapkan
      }
      if (extra && fingerprint(extra) !== fingerprint(message)) {
        facts.unexpectedInboxMessage = true;
        throw new Error("ABORT: inbox menerima pesan tak terduga (batas 1 email per run terlampaui)");
      }
    });
  } catch (err) {
    failure = String(err instanceof Error ? err.message : err);
  } finally {
    try {
      await step(11, async () => {
        const user = await adminClient.findUserByEmail(email);
        if (user) await adminClient.deleteUser(user.id);
        return user ? "pengguna QA dihapus" : "tidak ada yang perlu dihapus";
      });
    } catch (err) {
      failure ??= String(err instanceof Error ? err.message : err);
    }
  }

  const executed = new Set(steps.map((s) => s.n));
  const report = {
    tool: "qa-2-real-e2e",
    result: failure === null ? "PASS" : "FAIL",
    note: "Hanya bukti bila dijalankan dengan dependensi nyata di lingkungan QA; bukan klaim REAL PASS.",
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(clock.now()).toISOString(),
    ...facts,
    steps,
    notRun: PLAN.map((_, i) => i + 1).filter((n) => !executed.has(n)),
    ...(failure === null ? {} : { error: failure }),
  };
  return { exitCode: failure === null ? EXIT.PASS : EXIT.FAIL, report, json: scrub(JSON.stringify(report, null, 2), env, secretsSeen) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  });
}
