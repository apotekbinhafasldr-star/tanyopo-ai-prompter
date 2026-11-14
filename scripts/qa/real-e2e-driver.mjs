import { findViolations } from "./local-stack-guard.mjs";
import { ALLOWED_QA_PROJECT_REFS } from "./qa-project-allowlist.mjs";
import { isLockedQaAddress, redact } from "./real-e2e-guard.mjs";

// QA-2: driver browser untuk runRealE2E (scripts/qa/real-e2e.mjs). INERT: tidak diimpor oleh main(); tidak ada jaringan
// saat modul dimuat. Tidak membaca process.env; secret hanya lewat parameter. Playwright TIDAK ada di package.json (CI QA-1
// memasangnya ad hoc), jadi hanya diimpor dinamis bila `browser` tidak disuntikkan.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const PRODUCTION_HOST_MARKERS = ["tanyopo.com", "netlify.app", "netlify.com", "vercel.app", "vercel.com", "supabase.com"];
const SUPABASE_QA_URL_RE = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/;
const MAX_HOPS_TOTAL = 20;
const BRAND_NAME = "QA Linoe Brand";

export const DRIVER_DEFAULTS = Object.freeze({ stepTimeoutMs: 30_000, onboardingTimeoutMs: 90_000, hopTimeoutMs: 15_000 });

/** @param {string} urlText @returns {URL} */
function parseUrl(urlText) {
  try {
    return new URL(urlText);
  } catch {
    throw new Error("URL tidak valid");
  }
}

/** @param {string} hostname */
const isProductionHost = (hostname) => PRODUCTION_HOST_MARKERS.some((m) => hostname === m || hostname.endsWith(`.${m}`));

/**
 * Fail-closed saat konstruksi. Murni; melempar bila ditolak. Pesan tidak memuat nilai URL mentah.
 * @param {{ appUrl: string, qaSupabaseUrl: string, allowedOrigins: readonly string[], exactAppOrigin?: string }} o
 * @returns {{ appOrigin: string, supabaseOrigin: string, allowedOrigins: string[] }}
 */
export function validateDriverTargets(o) {
  const app = parseUrl(String(o.appUrl));
  if (app.username !== "" || app.password !== "") throw new Error("DRIVER REFUSED: appUrl memuat userinfo");
  if (isProductionHost(app.hostname)) throw new Error("DRIVER REFUSED: appUrl menunjuk host produksi/hosting");
  const local = LOCAL_HOSTS.has(app.hostname) && (app.protocol === "http:" || app.protocol === "https:");
  const exact = typeof o.exactAppOrigin === "string" && o.exactAppOrigin === app.origin && app.protocol === "https:";
  if (!local && !exact) throw new Error("DRIVER REFUSED: appUrl harus localhost/127.0.0.1 (atau origin https yang dikonfigurasi persis)");

  const supaText = String(o.qaSupabaseUrl);
  const m = SUPABASE_QA_URL_RE.exec(supaText);
  if (!m) throw new Error("DRIVER REFUSED: qaSupabaseUrl bukan https://<ref>.supabase.co polos");
  const ref = m[1];
  if (!ALLOWED_QA_PROJECT_REFS.includes(ref)) throw new Error("DRIVER REFUSED: ref Supabase tidak ada di allowlist proyek QA");
  if (findViolations({ REF: ref }).length > 0) throw new Error("DRIVER REFUSED: ref proyek produksi/bersama");
  const supa = parseUrl(supaText);

  if (!Array.isArray(o.allowedOrigins) || o.allowedOrigins.length === 0) throw new Error("DRIVER REFUSED: allowedOrigins kosong");
  const permitted = new Set([app.origin, supa.origin]);
  for (const origin of o.allowedOrigins) {
    if (typeof origin !== "string" || !permitted.has(origin)) throw new Error("DRIVER REFUSED: allowedOrigins memuat origin di luar aplikasi uji/Supabase QA");
  }
  return { appOrigin: app.origin, supabaseOrigin: supa.origin, allowedOrigins: [...new Set(o.allowedOrigins)] };
}

/**
 * Menyamarkan secret (nilai yang diberikan lewat parameter + token/cookie yang pernah terlihat) dan membuang URL mentah.
 * @param {unknown} err
 * @param {readonly string[]} secrets
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
export function sanitizeError(err, secrets, env) {
  const name = err instanceof Error && err.name ? err.name : "Error";
  const first = String(err instanceof Error ? err.message : err).split("\n")[0];
  let out = redact(first, env);
  for (const s of secrets) if (s) out = out.split(s).join("[REDACTED]");
  out = out.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[URL]");
  return `${name}: ${out.slice(0, 200)}`;
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, label) {
  /** @type {ReturnType<typeof setTimeout>} */
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: timeout ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Jar cookie in-memory (hanya host-only, hanya origin yang diizinkan). Nilai tidak pernah dikembalikan/dicatat. */
function createCookieJar() {
  /** @type {Map<string, Map<string, string>>} */
  const byOrigin = new Map();
  return {
    /** @param {string} origin @param {string[]} setCookies */
    store(origin, setCookies) {
      const jar = byOrigin.get(origin) ?? new Map();
      for (const line of setCookies) {
        const parts = line.split(";").map((p) => p.trim());
        const eq = parts[0].indexOf("=");
        if (eq < 1) continue;
        const name = parts[0].slice(0, eq);
        const value = parts[0].slice(eq + 1);
        const attrs = parts.slice(1).map((p) => p.toLowerCase());
        const maxAge = attrs.find((a) => a.startsWith("max-age="));
        const expires = attrs.find((a) => a.startsWith("expires="));
        const expired = (maxAge !== undefined && Number(maxAge.slice(8)) <= 0) || (expires !== undefined && Date.parse(expires.slice(8)) < Date.now());
        if (expired || value === "") jar.delete(name);
        else jar.set(name, value);
      }
      byOrigin.set(origin, jar);
    },
    /** @param {string} origin */
    header(origin) {
      const jar = byOrigin.get(origin);
      return jar && jar.size > 0 ? [...jar].map(([k, v]) => `${k}=${v}`).join("; ") : "";
    },
    /** @param {string} origin */
    entries(origin) {
      return [...(byOrigin.get(origin) ?? [])];
    },
    values() {
      return [...byOrigin.values()].flatMap((j) => [...j.values()]);
    },
  };
}

/**
 * @typedef {Object} DriverOptions
 * @property {string} appUrl aplikasi uji di runner (localhost/127.0.0.1)
 * @property {string} qaSupabaseUrl https://<ref QA di allowlist>.supabase.co
 * @property {readonly string[]} allowedOrigins subset {origin aplikasi, origin Supabase QA}
 * @property {any} [browser] objek bergaya Playwright Browser (newContext); bawaan: chromium dari paket playwright (impor dinamis)
 * @property {typeof fetch} [fetchImpl]
 * @property {string} [exactAppOrigin] origin https non-lokal yang diizinkan persis (opsional)
 * @property {Record<string, string | undefined>} [env] hanya untuk menyamarkan secret pada pesan error (lewat redact)
 * @property {{ stepTimeoutMs?: number, onboardingTimeoutMs?: number, hopTimeoutMs?: number }} [timeouts]
 */

/**
 * Membuat driver untuk runRealE2E. Konstruksi fail-closed dan SINKRON: tidak ada jaringan/peluncuran browser sampai langkah pertama.
 * @param {DriverOptions} options
 */
export function createRealDriver(options) {
  const { appOrigin, allowedOrigins } = validateDriverTargets(options);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const env = options.env ?? {};
  const t = { ...DRIVER_DEFAULTS, ...(options.timeouts ?? {}) };
  const jar = createCookieJar();
  /** @type {string[]} */
  const secrets = [];
  /** @type {Set<string>} */
  const blockedHosts = new Set();
  let signupCalls = 0;
  let duplicateCalls = 0;
  let hopCalls = 0;
  let boundEmail = null;
  let confirmed = false;
  /** @type {string | null} */
  let password = null;
  /** @type {any} */
  let session = null;

  /** @param {unknown} err */
  const fail = (err) => new Error(sanitizeError(err, [...secrets, ...jar.values()], env));
  /** @param {string} s */
  const remember = (s) => {
    if (s && !secrets.includes(s)) secrets.push(s);
  };

  /** @param {string} urlText */
  const originAllowed = (urlText) => {
    let u;
    try {
      u = new URL(urlText);
    } catch {
      return false;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.username !== "" || u.password !== "") return false;
    return allowedOrigins.includes(u.origin);
  };

  /** @param {string} email @param {string} pw */
  const bindIdentity = (email, pw) => {
    if (!isLockedQaAddress(email)) throw new Error("email bukan satu identitas @qa.tanyopo.com tanpa plus-addressing");
    if (boundEmail !== null && boundEmail !== email.toLowerCase()) throw new Error("email berbeda dari identitas yang sudah dipakai (hanya satu identitas)");
    if (typeof pw !== "string" || pw.length < 8) throw new Error("password uji wajib disuplai orkestrator");
    boundEmail = email.toLowerCase();
    password = pw;
    remember(pw);
  };

  async function getSession() {
    if (session) return session;
    let browser = options.browser;
    if (!browser) {
      const spec = "playwright"; // variabel: tanpa resolusi tipe/dependensi statis
      const mod = await import(spec);
      browser = await mod.chromium.launch();
    }
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", acceptDownloads: false });
    // Semua request (navigasi, subresource, XHR) di luar allowlist digagalkan; tidak ada pengecualian selain about:blank.
    await context.route("**/*", (/** @type {any} */ route) => {
      const url = route.request().url();
      if (url === "about:blank" || originAllowed(url)) return route.continue();
      try {
        blockedHosts.add(new URL(url).hostname || "?");
      } catch {
        blockedHosts.add("?");
      }
      return route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    if (typeof page.setDefaultTimeout === "function") page.setDefaultTimeout(t.stepTimeoutMs);
    session = { browser, context, page, ownsBrowser: !options.browser };
    return session;
  }

  /** @param {any} page */
  const assertPageOrigin = (page) => {
    const url = String(page.url());
    if (url !== "about:blank" && !originAllowed(url)) throw new Error("halaman berada di origin di luar allowlist");
  };

  /** @param {any} page @param {RegExp} re @param {number} ms */
  async function waitVisible(page, re, ms) {
    const end = Date.now() + ms;
    for (;;) {
      if (await page.getByText(re).first().isVisible()) return true;
      if (Date.now() >= end) return false;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /** @param {any} page @param {string} email @param {string} pw @param {{ nama: string, namaUsaha: string }} o */
  async function fillAndSubmitRegister(page, email, pw, o) {
    await page.goto(`${appOrigin}/register`);
    await page.fill("#nama", o.nama);
    await page.fill("#namaUsaha", o.namaUsaha);
    await page.fill("#email", email);
    await page.fill("#password", pw);
    await page.check("#acceptLegal");
    await page.getByRole("button", { name: "Daftar Gratis" }).click(); // tepat SATU klik; tanpa retry
    const created = await waitVisible(page, /Akun berhasil dibuat/, t.stepTimeoutMs);
    if (created) return "check-email";
    if (await page.getByText(/sudah terdaftar/).first().isVisible()) return "duplicate";
    return "timeout";
  }

  return {
    allowedOrigins,
    get signupCalls() {
      return signupCalls;
    },
    get blockedHosts() {
      return [...blockedHosts];
    },

    /**
     * Signup nyata (SATU kali; memicu satu email). Panggilan kedua melempar tanpa menyentuh browser.
     * @param {{ email: string, password: string, nama?: string, namaUsaha?: string }} o
     * @returns {Promise<{ outcome: string }>}
     */
    async signup(o) {
      if (signupCalls >= 1) throw new Error("batas signup 1 kali per driver terlampaui");
      signupCalls += 1; // dihitung SEBELUM aksi: kegagalan/timeout tidak membuka retry
      try {
        bindIdentity(o.email, o.password);
        const { page } = await getSession();
        const outcome = await withTimeout(
          fillAndSubmitRegister(page, o.email, o.password, { nama: o.nama ?? "QA Linoe", namaUsaha: o.namaUsaha ?? "QA Linoe Sandbox" }),
          t.stepTimeoutMs + 5_000,
          "signup",
        );
        assertPageOrigin(page);
        return { outcome };
      } catch (err) {
        throw fail(err);
      }
    },

    /**
     * Daftar ulang identitas yang SAMA. UI tidak dapat menjamin tanpa email (Supabase mengirim ulang email konfirmasi untuk akun
     * yang BELUM terkonfirmasi), maka driver menolak mengirim sebelum konfirmasi tercapai: outcome "refused-unconfirmed" tanpa
     * satu pun request. Setelah konfirmasi, Supabase tidak mengirim email untuk alamat terkonfirmasi (probe inbox orkestrator
     * langkah 10 yang menilai). Maksimal 1 panggilan.
     * @param {{ email: string, password: string, nama?: string, namaUsaha?: string }} o
     * @returns {Promise<{ outcome: string }>}
     */
    async signupDuplicate(o) {
      if (duplicateCalls >= 1) throw new Error("batas signupDuplicate 1 kali per driver terlampaui");
      duplicateCalls += 1;
      try {
        if (signupCalls < 1 || boundEmail === null) return { outcome: "refused-no-signup" };
        bindIdentity(o.email, o.password);
        if (!confirmed) return { outcome: "refused-unconfirmed" };
        const { page } = await getSession();
        const outcome = await withTimeout(
          fillAndSubmitRegister(page, o.email, o.password, { nama: o.nama ?? "QA Linoe", namaUsaha: o.namaUsaha ?? "QA Linoe Sandbox" }),
          t.stepTimeoutMs + 5_000,
          "signupDuplicate",
        );
        assertPageOrigin(page);
        return { outcome: outcome === "duplicate" ? "duplicate" : outcome === "check-email" ? "accepted-as-new" : outcome };
      } catch (err) {
        throw fail(err);
      }
    },

    /**
     * SATU request GET tanpa auto-redirect. Cookie in-memory dibawa antar-hop (agar sesi dari /auth/confirm berlaku di hop
     * berikutnya) dan tidak pernah dikembalikan/dicatat. Tidak ada retry.
     * @param {string} url
     * @returns {Promise<{ status: number, location?: string }>}
     */
    async fetchHop(url) {
      hopCalls += 1;
      if (hopCalls > MAX_HOPS_TOTAL) throw new Error("fetchHop: batas total hop terlampaui");
      remember(url);
      const controller = new AbortController();
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let timer;
      try {
        const u = parseUrl(url);
        const th = u.searchParams.get("token_hash") ?? u.searchParams.get("token");
        if (th) remember(th);
        if (!originAllowed(url)) throw new Error(`origin ${u.hostname} di luar allowlist`);
        const cookie = jar.header(u.origin);
        timer = setTimeout(() => controller.abort(Object.assign(new Error("timeout"), { name: "TimeoutError" })), t.hopTimeoutMs);
        const res = await fetchImpl(url, {
          method: "GET",
          redirect: "manual",
          credentials: "omit",
          headers: cookie ? { cookie } : {},
          signal: controller.signal,
        });
        const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
        if (setCookies.length > 0) jar.store(u.origin, setCookies);
        await res.body?.cancel?.().catch(() => {});
        if (res.status === 0 || /** @type {string} */ (res.type) === "opaqueredirect") throw new Error("respons opaque: status tidak terbaca");
        const location = res.headers.get("location") ?? undefined;
        if (res.status >= 200 && res.status < 300 && new URL(url).pathname === "/onboarding") confirmed = true;
        return location === undefined ? { status: res.status } : { status: res.status, location };
      } catch (err) {
        const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
        throw fail(timedOut ? new Error(`fetchHop timeout ${t.hopTimeoutMs} ms`) : err);
      } finally {
        clearTimeout(timer);
      }
    },

    /**
     * Onboarding 8 langkah di browser. Sesi dari jar fetchHop disuntikkan ke konteks; bila tetap diarahkan ke /login, login
     * dengan password uji yang diberikan orkestrator.
     * @returns {Promise<{ completed: boolean, url?: string }>}
     */
    async completeOnboarding() {
      try {
        const { context, page } = await getSession();
        const cookies = jar.entries(appOrigin).map(([name, value]) => ({ name, value, url: appOrigin }));
        if (cookies.length > 0) await context.addCookies(cookies);
        const run = async () => {
          await page.goto(`${appOrigin}/onboarding`);
          if (new URL(page.url()).pathname === "/login") {
            if (password === null) throw new Error("sesi tidak ada dan password tidak tersedia");
            await page.fill("#email", /** @type {string} */ (boundEmail));
            await page.fill("#password", password);
            await page.getByRole("button", { name: "Masuk" }).click();
            await page.waitForURL("**/onboarding");
          }
          await page.locator("#brandNameInput").fill(BRAND_NAME);
          const next = page.getByRole("button", { name: "Lanjut" });
          await next.click(); // 1 -> 2
          await next.click(); // 2 -> 3
          await page.locator("button[aria-pressed]").first().click();
          await next.click(); // 3 -> 4
          await page.locator("textarea").fill("Kopi kemasan siap seduh dari petani lokal.");
          await next.click(); // 4 -> 5
          await page.locator("button[aria-pressed]").first().click();
          await next.click(); // 5 -> 6
          await next.click(); // 6 -> 7
          const toDashboard = page.waitForURL("**/dashboard", { timeout: t.onboardingTimeoutMs });
          await next.click(); // 7 -> 8 (aplikasi dapat langsung mengirim form di sini; lihat QA-1)
          const submit = page.getByRole("button", { name: "Selesai, ke Dashboard" });
          const busy = await submit.getAttribute("aria-busy", { timeout: 3000 }).catch(() => null);
          if (busy !== "true") await submit.click().catch(() => {});
          await toDashboard;
        };
        await withTimeout(run(), t.onboardingTimeoutMs + 10_000, "completeOnboarding");
        assertPageOrigin(page);
        const finalUrl = new URL(page.url());
        return { completed: finalUrl.pathname === "/dashboard", url: finalUrl.origin + finalUrl.pathname };
      } catch (err) {
        throw fail(err);
      }
    },

    /** @returns {Promise<{ status: number, url: string }>} */
    async openDashboard() {
      return navigate("/dashboard");
    },

    /** @returns {Promise<{ status: number, url: string }>} */
    async openBilling() {
      return navigate("/billing");
    },

    /** Menutup browser yang dibuat driver (bukan yang disuntikkan). */
    async close() {
      const s = session;
      session = null;
      if (!s) return;
      await s.context.close?.().catch(() => {});
      if (s.ownsBrowser) await s.browser.close?.().catch(() => {});
    },
  };

  /** @param {string} path */
  async function navigate(path) {
    try {
      const { page } = await getSession();
      const res = await withTimeout(page.goto(`${appOrigin}${path}`), t.stepTimeoutMs + 5_000, `buka ${path}`);
      assertPageOrigin(page);
      const u = new URL(page.url());
      return { status: res ? res.status() : 0, url: u.origin + u.pathname };
    } catch (err) {
      throw fail(err);
    }
  }
}
