import { describe, expect, it } from "vitest";
import { createRealDriver as createRealDriverUntyped, validateDriverTargets, sanitizeError } from "../../../scripts/qa/real-e2e-driver.mjs";

// Berkas .mjs bertipe sempit lewat JSDoc; tes memakai bentuk longgar (pelajaran #153: tipe tes tidak boleh membuat CI merah).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const createRealDriver = createRealDriverUntyped as unknown as (o: Any) => Any;

// Semua PALSU/lokal: tanpa jaringan, tanpa browser nyata. Ref QA adalah ref publik di allowlist repo (bukan rahasia).
const QA_REF = "gasdqsadnjoknisloaec";
const SUPA = `https://${QA_REF}.supabase.co`;
const APP = "http://localhost:3000";
const EMAIL = "qa-inbox@qa.tanyopo.com";
const PW = "PW-FAKE-PASSWORD-999";
const TOKEN = "TOKENHASH-SECRET-123";
const COOKIE_VAL = "COOKIE-SECRET-456";

function base(extra: Record<string, unknown> = {}) {
  return { appUrl: APP, qaSupabaseUrl: SUPA, allowedOrigins: [APP, SUPA], ...extra };
}

type Opts = { visible?: string[]; failGoto?: string; pathAfterGoto?: Record<string, string> };

function fakeBrowser(o: Opts = {}) {
  const log: string[] = [];
  let handler: Any = null;
  let current = "about:blank";
  const aborted: string[] = [];
  const visible = new Set(o.visible ?? ["Akun berhasil dibuat"]);
  const request = async (url: string) => {
    let ok = true;
    await handler({ request: () => ({ url: () => url }), continue: () => undefined, abort: () => { ok = false; aborted.push(url); } });
    return ok;
  };
  const clicks = { daftar: 0 };
  const page: Any = {
    setDefaultTimeout: () => undefined,
    url: () => current,
    goto: async (url: string) => {
      log.push(`goto ${url}`);
      if (!(await request(url))) throw new Error(`net::ERR_BLOCKED ${url}`);
      if (o.failGoto === url) throw new Error(`gagal ${url}?token_hash=${TOKEN}`);
      current = o.pathAfterGoto?.[url] ?? url;
      return { status: () => 200 };
    },
    fill: async (sel: string) => void log.push(`fill ${sel}`),
    check: async () => undefined,
    waitForURL: async () => undefined,
    getByText: (re: RegExp) => ({ first: () => ({ isVisible: async () => [...visible].some((v) => re.test(v)) }) }),
    getByRole: (_r: string, q: { name: string }) => ({
      click: async () => void (q.name === "Daftar Gratis" ? (clicks.daftar += 1) : log.push(`click ${q.name}`)),
      getAttribute: async () => "true",
    }),
    locator: () => ({ fill: async () => undefined, first: () => ({ click: async () => undefined }) }),
  };
  const context: Any = {
    route: async (_p: string, h: unknown) => void (handler = h),
    newPage: async () => page,
    addCookies: async (c: unknown[]) => void log.push(`addCookies ${c.length}`),
    close: async () => undefined,
  };
  let contexts = 0;
  const browser: Any = { newContext: async () => ((contexts += 1), context), close: async () => undefined };
  return { browser, log, request, aborted, clicks, page, get contexts() { return contexts; } };
}

describe("konstruktor fail-closed", () => {
  it.each([
    ["host produksi tanyopo.com", base({ appUrl: "https://app.tanyopo.com" })],
    ["netlify.app", base({ appUrl: "https://x.netlify.app" })],
    ["host non-lokal tanpa konfigurasi persis", base({ appUrl: "https://example.org" })],
    ["ref lain", base({ qaSupabaseUrl: "https://abcdefghij0123456789.supabase.co" })],
    ["umkmpro-ai bersama", base({ qaSupabaseUrl: "https://wjjyqovhmwenbcvbnkgx.supabase.co" })],
    ["domain .supabase.com", base({ qaSupabaseUrl: `https://${QA_REF}.supabase.com` })],
    ["supabase dengan path", base({ qaSupabaseUrl: `${SUPA}/rest/v1` })],
    ["allowedOrigins asing", base({ allowedOrigins: [APP, SUPA, "https://evil.example"] })],
    ["allowedOrigins kosong", base({ allowedOrigins: [] })],
    ["appUrl dengan userinfo", base({ appUrl: "http://user:pw@localhost:3000" })],
  ])("menolak %s", (_n, opts) => {
    expect(() => createRealDriver(opts)).toThrow(/DRIVER REFUSED/);
  });

  it("menerima konfigurasi lokal + ref QA, dan origin https yang dikonfigurasi persis", () => {
    expect(() => createRealDriver(base())).not.toThrow();
    const origin = "https://qa-app.example.org";
    expect(() => createRealDriver({ appUrl: origin, qaSupabaseUrl: SUPA, allowedOrigins: [origin, SUPA], exactAppOrigin: origin })).not.toThrow();
    expect(() => validateDriverTargets({ appUrl: origin, qaSupabaseUrl: SUPA, allowedOrigins: [origin], exactAppOrigin: "https://lain.example.org" })).toThrow(/DRIVER REFUSED/);
  });

  it("konstruksi tidak meluncurkan browser maupun fetch", () => {
    let launched = 0;
    createRealDriver(base({ browser: { newContext: async () => void (launched += 1) }, fetchImpl: () => void (launched += 1) }));
    expect(launched).toBe(0);
  });
});

describe("pemblokiran origin browser", () => {
  it("request ke origin asing (termasuk subresource) diabort; origin allowlist lolos", async () => {
    const fb = fakeBrowser();
    const d = createRealDriver(base({ browser: fb.browser }));
    await d.openDashboard();
    expect(await fb.request(`${SUPA}/auth/v1/signup`)).toBe(true);
    expect(await fb.request("https://fonts.googleapis.com/css")).toBe(false);
    expect(await fb.request("https://app.tanyopo.com/")).toBe(false);
    expect(await fb.request("https://wjjyqovhmwenbcvbnkgx.supabase.co/rest/v1/x")).toBe(false);
    expect(await fb.request("data:text/html,x")).toBe(false);
    expect(await fb.request("http://localhost:3001/")).toBe(false);
    expect(d.blockedHosts).toContain("fonts.googleapis.com");
  });

  it("navigasi yang berakhir di origin asing dianggap gagal", async () => {
    const fb = fakeBrowser({ pathAfterGoto: { [`${APP}/dashboard`]: "https://evil.example/x" } });
    const d = createRealDriver(base({ browser: fb.browser }));
    await expect(d.openDashboard()).rejects.toThrow(/allowlist/);
  });

  it("openDashboard/openBilling hanya mengembalikan status + url tanpa query", async () => {
    const fb = fakeBrowser({ pathAfterGoto: { [`${APP}/billing`]: `${APP}/billing?x=${TOKEN}` } });
    const d = createRealDriver(base({ browser: fb.browser }));
    expect(await d.openDashboard()).toEqual({ status: 200, url: `${APP}/dashboard` });
    expect(await d.openBilling()).toEqual({ status: 200, url: `${APP}/billing` });
  });
});

describe("fetchHop", () => {
  function fakeFetch(res: { status: number; location?: string; cookies?: string[] }) {
    const calls: Array<{ url: string; init: Any }> = [];
    const fn = async (url: string, init: Any) => {
      calls.push({ url, init });
      const headers = Object.assign(new Headers(res.location ? { location: res.location } : {}), { getSetCookie: () => res.cookies ?? [] });
      return { status: res.status, headers, body: null, type: "basic" };
    };
    return { fn, calls };
  }

  it("satu request per panggilan, redirect:manual, tidak mengikuti Location", async () => {
    const f = fakeFetch({ status: 307, location: `${APP}/onboarding` });
    const d = createRealDriver(base({ fetchImpl: f.fn }));
    const r = await d.fetchHop(`${APP}/auth/confirm?token_hash=${TOKEN}&type=signup`);
    expect(r).toEqual({ status: 307, location: `${APP}/onboarding` });
    expect(f.calls.length).toBe(1);
    expect(f.calls[0].init.redirect).toBe("manual");
    expect(f.calls[0].init.credentials).toBe("omit");
    expect(f.calls[0].init.signal).toBeDefined();
  });

  it("menolak URL asing/produksi tanpa request; error tanpa token", async () => {
    const f = fakeFetch({ status: 200 });
    const d = createRealDriver(base({ fetchImpl: f.fn }));
    for (const u of [`https://app.tanyopo.com/auth/confirm?token_hash=${TOKEN}`, `https://wjjyqovhmwenbcvbnkgx.supabase.co/auth/v1/verify?token=${TOKEN}`]) {
      const err = await d.fetchHop(u).catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect(String(err.message)).not.toContain(TOKEN);
      expect(String(err.message)).not.toContain("tanyopo.com/auth");
    }
    expect(f.calls.length).toBe(0);
  });

  it("cookie dibawa antar-hop tetapi tidak pernah muncul di hasil atau error", async () => {
    const calls: Any[] = [];
    let n = 0;
    const fetchImpl = async (url: string, init: Any) => {
      calls.push({ url, init });
      n += 1;
      if (n === 1) {
        const h = Object.assign(new Headers({ location: `${APP}/onboarding` }), { getSetCookie: () => [`sb-access=${COOKIE_VAL}; Path=/; HttpOnly`] });
        return { status: 307, headers: h, body: null, type: "basic" };
      }
      if (n === 2) return { status: 200, headers: Object.assign(new Headers(), { getSetCookie: () => [] }), body: null, type: "basic" };
      throw new Error(`koneksi gagal sb-access=${COOKIE_VAL} ${url}`);
    };
    const d = createRealDriver(base({ fetchImpl }));
    const r1 = await d.fetchHop(`${APP}/auth/confirm?token_hash=${TOKEN}`);
    const r2 = await d.fetchHop(`${APP}/onboarding`);
    expect(JSON.stringify([r1, r2])).not.toContain(COOKIE_VAL);
    expect(calls[1].init.headers.cookie).toContain(COOKIE_VAL); // dikirim ke origin yang sama
    const err = await d.fetchHop(`${APP}/dashboard?t=${TOKEN}`).catch((e: Error) => e);
    expect(String(err.message)).not.toContain(COOKIE_VAL);
    expect(String(err.message)).not.toContain(TOKEN);
    expect(String(err.message)).not.toMatch(/https?:\/\//);
  });

  it("timeout: error jelas tanpa URL/token", async () => {
    const fetchImpl = (_u: string, init: Any) =>
      new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error(`aborted ${APP}/x?token_hash=${TOKEN}`), { name: "TimeoutError" }))));
    const d = createRealDriver(base({ fetchImpl, timeouts: { hopTimeoutMs: 20 } }));
    const err = await d.fetchHop(`${APP}/auth/confirm?token_hash=${TOKEN}`).catch((e: Error) => e);
    expect(String(err.message)).toMatch(/timeout 20 ms/);
    expect(String(err.message)).not.toContain(TOKEN);
  });

  it("respons opaque ditolak; total hop dibatasi", async () => {
    const f = fakeFetch({ status: 200 });
    const d = createRealDriver(base({ fetchImpl: async () => ({ status: 0, type: "opaqueredirect", headers: new Headers(), body: null }) }));
    await expect(d.fetchHop(`${APP}/x`)).rejects.toThrow(/opaque/);
    const d2 = createRealDriver(base({ fetchImpl: f.fn }));
    for (let i = 0; i < 20; i += 1) await d2.fetchHop(`${APP}/p${i}`);
    await expect(d2.fetchHop(`${APP}/p-extra`)).rejects.toThrow(/batas total hop/);
  });
});

describe("signup dan identitas", () => {
  it("signup maksimal 1 kali, satu klik, tanpa retry walau gagal/timeout", async () => {
    const fb = fakeBrowser({ visible: [] }); // tidak ada pesan: timeout
    const d = createRealDriver(base({ browser: fb.browser, timeouts: { stepTimeoutMs: 30 } }));
    const r = await d.signup({ email: EMAIL, password: PW });
    expect(r.outcome).toBe("timeout");
    expect(fb.clicks.daftar).toBe(1);
    await expect(d.signup({ email: EMAIL, password: PW })).rejects.toThrow(/batas signup 1 kali/);
    expect(fb.clicks.daftar).toBe(1);
    expect(d.signupCalls).toBe(1);
  });

  it("outcome check-email bila pesan tampil", async () => {
    const fb = fakeBrowser();
    const d = createRealDriver(base({ browser: fb.browser }));
    expect(await d.signup({ email: EMAIL, password: PW })).toEqual({ outcome: "check-email" });
  });

  it("menolak email selain satu identitas @qa.tanyopo.com (plus-address, domain lain, huruf besar berbeda tetap identitas)", async () => {
    for (const email of ["qa+1@qa.tanyopo.com", "qa@tanyopo.com", "qa@example.test", "a@qa.tanyopo.com,b@qa.tanyopo.com"]) {
      const fb = fakeBrowser();
      const d = createRealDriver(base({ browser: fb.browser }));
      await expect(d.signup({ email, password: PW })).rejects.toThrow(/identitas/);
      expect(fb.clicks.daftar).toBe(0);
    }
  });

  it("password tidak muncul di error maupun hasil; password kosong ditolak", async () => {
    const fb = fakeBrowser({ failGoto: `${APP}/register` });
    const d = createRealDriver(base({ browser: fb.browser }));
    const err = await d.signup({ email: EMAIL, password: PW }).catch((e: Error) => e);
    expect(String(err.message)).not.toContain(PW);
    expect(String(err.message)).not.toContain(TOKEN);
    const d2 = createRealDriver(base({ browser: fakeBrowser().browser }));
    await expect(d2.signup({ email: EMAIL, password: "" })).rejects.toThrow(/password/);
  });

  it("signupDuplicate: tanpa signup/konfirmasi tidak menyentuh browser (tidak boleh memicu email)", async () => {
    const fb = fakeBrowser();
    const d = createRealDriver(base({ browser: fb.browser }));
    expect(await d.signupDuplicate({ email: EMAIL, password: PW })).toEqual({ outcome: "refused-no-signup" });
    expect(fb.clicks.daftar).toBe(0);
    const fb2 = fakeBrowser();
    const d2 = createRealDriver(base({ browser: fb2.browser }));
    await d2.signup({ email: EMAIL, password: PW });
    expect(await d2.signupDuplicate({ email: EMAIL, password: PW })).toEqual({ outcome: "refused-unconfirmed" });
    expect(fb2.clicks.daftar).toBe(1); // hanya klik signup pertama
  });

  it("signupDuplicate setelah konfirmasi: outcome duplicate, maks 1 kali, email harus sama", async () => {
    const fb = fakeBrowser({ visible: ["Akun berhasil dibuat", "Email ini sudah terdaftar"] });
    const fetchImpl = async () => ({ status: 200, headers: Object.assign(new Headers(), { getSetCookie: () => [] }), body: null, type: "basic" });
    const d = createRealDriver(base({ browser: fb.browser, fetchImpl }));
    await d.signup({ email: EMAIL, password: PW });
    await d.fetchHop(`${APP}/onboarding`); // 2xx di /onboarding = akun terkonfirmasi
    await expect(d.signupDuplicate({ email: "lain@qa.tanyopo.com", password: PW })).rejects.toThrow(/identitas/);
    // panggilan di atas sudah menghabiskan jatah (dihitung sebelum aksi)
    await expect(d.signupDuplicate({ email: EMAIL, password: PW })).rejects.toThrow(/batas signupDuplicate/);
  });

  it("signupDuplicate setelah konfirmasi mengembalikan duplicate bila UI menolak", async () => {
    const fb = fakeBrowser({ visible: ["Email ini sudah terdaftar"] });
    const fetchImpl = async () => ({ status: 200, headers: Object.assign(new Headers(), { getSetCookie: () => [] }), body: null, type: "basic" });
    const d = createRealDriver(base({ browser: fb.browser, fetchImpl, timeouts: { stepTimeoutMs: 30 } }));
    await d.signup({ email: EMAIL, password: PW }); // outcome tidak relevan di sini
    await d.fetchHop(`${APP}/onboarding`);
    expect(await d.signupDuplicate({ email: EMAIL, password: PW })).toEqual({ outcome: "duplicate" });
  });
});

describe("onboarding dan sanitasi", () => {
  it("completeOnboarding menyuntikkan cookie jar ke konteks dan melaporkan /dashboard", async () => {
    const fb = fakeBrowser({ pathAfterGoto: { [`${APP}/onboarding`]: `${APP}/dashboard` } });
    const fetchImpl = async () => ({ status: 200, headers: Object.assign(new Headers(), { getSetCookie: () => [`sb=${COOKIE_VAL}; Path=/`] }), body: null, type: "basic" });
    const d = createRealDriver(base({ browser: fb.browser, fetchImpl }));
    await d.fetchHop(`${APP}/auth/confirm?token_hash=${TOKEN}`);
    const r = await d.completeOnboarding();
    expect(r).toEqual({ completed: true, url: `${APP}/dashboard` });
    expect(fb.log).toContain("addCookies 1");
    expect(JSON.stringify(r)).not.toContain(COOKIE_VAL);
  });

  it("sanitizeError membuang URL, secret parameter, dan hanya baris pertama", () => {
    const msg = sanitizeError(new Error(`gagal https://x.example/a?token=${TOKEN} sk=ZZ-SECRET\nbaris dua rahasia`), [TOKEN], { QA_SUPABASE_SECRET_KEY: "ZZ-SECRET" });
    expect(msg).not.toContain(TOKEN);
    expect(msg).not.toContain("ZZ-SECRET");
    expect(msg).not.toContain("baris dua");
    expect(msg).not.toMatch(/https?:/);
  });
});
