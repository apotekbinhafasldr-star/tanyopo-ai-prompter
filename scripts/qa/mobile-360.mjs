// QA mobile 360px. Runs ONLY against a locally started production build on the CI runner.
// Login-gated screens use scripts/qa/mock-supabase.mjs (a fake backend on the runner); the app has no test bypass.
import { chromium, request as pwRequest } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { USERS, C1 } from "./mock-supabase.mjs";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { classify, isFatalKey, keysOf, validateBaseline } from "./mobile-360-keys.mjs";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
if (!/^http:\/\/localhost(:\d+)?$/.test(BASE)) throw new Error("QA runs against localhost only");
const MOCK = "http://localhost:54321";
const OUT = "qa-output";
mkdirSync(OUT, { recursive: true });
const MIN = 44;
// A normal mobile UA: the demo entry deliberately answers 204 to HeadlessChrome (anti-bot guard in lib/demo/start-guard.ts).
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const b64u = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
function sessionCookie(user) {
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const token = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub: user.id, aud: "authenticated", role: "authenticated", exp })}.sig`;
  const session = { access_token: token, token_type: "bearer", expires_in: 86400, expires_at: exp, refresh_token: "qa-refresh", user: { id: user.id, email: user.email, aud: "authenticated" } };
  return { name: "sb-localhost-auth-token", value: "base64-" + b64u(session), domain: "localhost", path: "/", httpOnly: false, sameSite: "Lax" };
}

const browser = await chromium.launch();
const mk = async (cookies) => {
  const c = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA });
  if (cookies) await c.addCookies(cookies);
  return c;
};

async function measure(page) {
  return page.evaluate((MIN) => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
    const name = (el) => (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || el.getAttribute("name") || el.tagName).trim().slice(0, 40);
    const doc = document.documentElement;
    const offenders = [...document.querySelectorAll("body *")].filter((e) => vis(e) && e.getBoundingClientRect().right > doc.clientWidth + 1 && !e.closest("[class*=overflow-x-auto]")).slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 40)}`);
    const targets = [...document.querySelectorAll("button, input:not([type=hidden]), select, textarea, [role=button], nav a, header a, aside a, a[class*=btn], a[data-slot=button]")].filter(vis);
    const small = targets.map((e) => { const box = ["checkbox", "radio"].includes(e.type) && e.closest("label") ? e.closest("label") : e; const r = box.getBoundingClientRect(); return { el: e.tagName.toLowerCase(), name: name(e), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((t) => t.h < MIN || t.w < MIN);
    const unnamedButtons = [...document.querySelectorAll("button, [role=button]")].filter((e) => vis(e) && !name(e).replace(e.tagName, "")).length;
    const unlabeled = [...document.querySelectorAll("input:not([type=hidden]), select, textarea")].filter((e) => vis(e) && !(e.getAttribute("aria-label") || e.getAttribute("aria-labelledby") || (e.id && document.querySelector(`label[for="${CSS.escape(e.id)}"]`)) || e.closest("label")));
    const inputsNoLabel = unlabeled.length;
    const unlabeledInfo = unlabeled.slice(0, 5).map((e) => `${e.tagName.toLowerCase()}[type=${e.type}][name=${e.name}][ph=${e.placeholder ?? ""}]`);
    return { innerWidth: innerWidth, overflowX: doc.scrollWidth - doc.clientWidth, offenders, targetCount: targets.length, small, unnamedButtons, inputsNoLabel, unlabeledInfo, lang: doc.lang, h1: document.querySelectorAll("h1").length, title: document.title };
  }, MIN);
}


// Small JPEG (CSS-pixel scale) so the picture can be read back from the CI log when artifacts cannot be downloaded.
async function jpeg(page, label) {
  try {
    mkdirSync(`${OUT}/jpg`, { recursive: true });
    // Scroll through the page so scroll-triggered reveal animations run before the picture is taken.
    await page.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } window.scrollTo(0, 0); await new Promise((r) => setTimeout(r, 400)); });
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    const cap = label === "public_root" ? 5200 : 2600;
    await page.screenshot({ path: `${OUT}/jpg/${label}.jpg`, type: "jpeg", quality: 50, scale: "css", fullPage: true, clip: { x: 0, y: 0, width: 360, height: Math.min(h, cap) } });
  } catch (e) { console.log("jpeg failed", label, String(e).split("\n")[0]); }
}
const report = [];
// Temuan yang SUDAH ADA di main dicatat di baseline (dengan alasan); hanya temuan BARU yang menggagalkan job.
const BASELINE_FILE = JSON.parse(readFileSync(new URL("./mobile-360-baseline.json", import.meta.url), "utf8"));
const baselineErrors = validateBaseline(BASELINE_FILE);
if (baselineErrors.length) throw new Error("Baseline tidak sah:\n" + baselineErrors.join("\n"));
const BASELINE = BASELINE_FILE.accepted ?? {};
// Semua node pelanggaran serious/critical (bukan hanya yang pertama) agar pelanggaran baru dengan aturan sama terlihat.
const axeOf = async (page) =>
  (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.length,
    targets: v.nodes.map((n) => (Array.isArray(n.target) ? n.target.flat().join(" >> ") : String(n.target))),
  }));
const pathOf = (u) => { try { return new URL(u, "http://x").pathname; } catch { return "-"; } };
async function audit(ctx, label, route, { wait = "networkidle", before, afterNav } = {}) {
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 140)));
  const entry = { label, route };
  try {
    if (before) await before();
    const res = await page.goto(BASE + route, { waitUntil: wait, timeout: 45000 });
    entry.status = res?.status();
    if (afterNav) await afterNav(page);
    await page.waitForTimeout(400);
    entry.finalUrl = page.url().replace(BASE, "");
    entry.requestedPath = pathOf(route);
    entry.finalPath = pathOf(entry.finalUrl);
    Object.assign(entry, await measure(page));
    entry.axe = await axeOf(page);
    entry.consoleErrors = consoleErrors.slice(0, 3);
    await page.screenshot({ path: `${OUT}/${label}.png`, fullPage: true });
    await jpeg(page, label);
  } catch (e) { entry.error = String(e).split("\n")[0]; }
  report.push(entry);
  await page.close();
  return entry;
}

// 1) public pages
const pub = await mk();
for (const r of ["/", "/login", "/register", "/forgot-password", "/reset-password", "/privacy", "/terms", "/refund", "/data-deletion"]) await audit(pub, `public_${r.replace(/\W+/g, "") || "root"}`, r);

// 2) demo: sesi demo bertanda tangan (cookie Secure+HttpOnly dari /api/demo/start; aplikasi TIDAK diubah/dilonggarkan).
// Diagnostik aman: hanya boolean/status/path/panjang yang dicetak; nilai token, cookie, dan secret tidak pernah dicetak.
const NAV = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };
const RUNNER_SECRET = process.env.DEMO_SESSION_SECRET ?? "";
const flagsOf = (sc) => ({ present: Boolean(sc), secure: /;\s*secure/i.test(sc), httpOnly: /;\s*httponly/i.test(sc), sameSite: (sc.match(/samesite=(\w+)/i)?.[1] ?? "none").toLowerCase() });
function tokenInfo(token) {
  const parts = token.split(".");
  const info = { parts: parts.length, sigHexLen: (parts[3] ?? "").length, signedWithRunnerSecret: "unknown", expiredByRunnerClock: "unknown" };
  if (parts.length === 4 && RUNNER_SECRET) {
    info.signedWithRunnerSecret = createHmac("sha256", RUNNER_SECRET).update(parts.slice(0, 3).join(".")).digest("hex") === parts[3];
    info.expiredByRunnerClock = Date.now() > Number(parts[2]);
  }
  return info;
}
const probeReq = async (rc, headers = {}) => { const r = await rc.get(BASE + "/demo/dashboard", { maxRedirects: 0, headers }); return { status: r.status(), location: r.headers().location ? pathOf(r.headers().location) : "-" }; };
async function probeBrowser(ctx) {
  const page = await ctx.newPage();
  try { await page.goto(BASE + "/demo/dashboard", { waitUntil: "domcontentloaded", timeout: 20000 }); return { ok: pathOf(page.url()) === "/demo/dashboard", finalPath: pathOf(page.url()) }; }
  catch (e) { return { ok: false, error: String(e).split("\n")[0].replace(/at http\S+/, "").trim() }; }
  finally { await page.close(); }
}
const diag = { runnerSecretKnownToHarness: Boolean(RUNNER_SECRET) };
let demo = null;
{
  const probeCtx = await mk();
  const r0 = await probeCtx.request.get(BASE + "/api/demo/start", { maxRedirects: 0, headers: NAV });
  const sc = r0.headers()["set-cookie"] ?? "";
  diag.start = { status: r0.status(), location: r0.headers().location ? pathOf(r0.headers().location) : "-", cookie: flagsOf(sc) };
  let name = null, token = null;
  if (sc) { const [pair] = sc.split(";"); const i = pair.indexOf("="); name = pair.slice(0, i); token = pair.slice(i + 1); diag.token = tokenInfo(token); }
  if (token) {
    diag.jarAfterStart = (await probeCtx.cookies(BASE)).filter((c) => c.name === name).map((c) => ({ domain: c.domain, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, sameValueAsSetCookie: c.value === token }));
    diag.probe_jarFromStart_request = await probeReq(probeCtx.request);
    const iso = await pwRequest.newContext();
    diag.probe_explicitCookieHeader_noJar = await probeReq(iso, { cookie: `${name}=${token}` });
    await iso.dispose();
    // Metode memasang cookie yang sama (nilai identik) ke jar browser; atribut aplikasi tidak diubah.
    const methods = {
      jarFromStart: async (c) => c,
      addCookieByUrl: async (c) => { await c.addCookies([{ name, value: token, url: BASE }]); return c; },
      addCookieByUrlSecure: async (c) => { await c.addCookies([{ name, value: token, url: BASE, secure: true }]); return c; },
      addCookieDomainPath: async (c) => { await c.addCookies([{ name, value: token, domain: "localhost", path: "/" }]); return c; },
    };
    diag.browserProbe = {};
    for (const [m, setup] of Object.entries(methods)) {
      const c = m === "jarFromStart" ? probeCtx : await mk();
      await setup(c);
      const res = await probeBrowser(c);
      diag.browserProbe[m] = res;
      if (res.ok && !demo) demo = c;
      if (c !== probeCtx && c !== demo) await c.close();
    }
  }
  console.log("DEMO-DIAG " + JSON.stringify(diag));
  if (!demo) demo = probeCtx; // tidak ada metode yang berhasil: halaman demo tetap diaudit dan GAGAL (load/redirect), tidak dilewati
}
for (const r of ["/demo/dashboard", "/demo/products", "/demo/campaign", "/demo/content", "/demo/analytics"]) await audit(demo, `demo_${r.split("/").pop()}`, r);


// 3) login-gated screens (fixture session)
const authed = await mk([sessionCookie(USERS.complete)]);
for (const r of ["/dashboard", "/connections", "/billing", "/campaigns", "/products", "/content", "/analytics", "/settings", "/promote", "/promote?mode=advanced"]) await audit(authed, `app_${r.slice(1).replace(/\W+/g, "_")}`, r);
await audit(authed, "app_campaign_detail", `/campaigns/${C1}`);
// Konfirmasi paket di /billing (tombol "Pilih Paket Ini" pertama), lalu drawer menu terbuka di 360px.
await audit(authed, "app_billing_confirm", "/billing", { afterNav: async (page) => { await page.locator("button", { hasText: "Pilih Paket Ini" }).first().click({ timeout: 5000 }); } });
await audit(authed, "app_dashboard_drawer_open", "/dashboard", { afterNav: async (page) => { await page.getByRole("button", { name: "Buka menu" }).click({ timeout: 5000 }); } });
const fresh = await mk([sessionCookie(USERS.newbie)]);
await audit(fresh, "onboarding", "/onboarding");

// 4) loading state: slow the fake backend, capture the route-segment skeleton
// Soft navigation with a slow data source: the route-segment skeleton (app/(app)/loading.tsx) must appear at once.
{
  const page = await authed.newPage();
  const entry = { label: "loading_state", route: "/connections -> /campaigns (slow data)" };
  try {
    await fetch(`${MOCK}/__delay?ms=0`);
    await page.goto(BASE + "/connections", { waitUntil: "networkidle", timeout: 45000 });
    await fetch(`${MOCK}/__delay?ms=4000`);
    await page.evaluate(() => document.querySelector('a[href="/campaigns"]')?.click());
    await page.waitForSelector("[role=status][aria-busy=true]", { timeout: 12000 });
    entry.status = 200; entry.finalUrl = "(skeleton shown)";
    Object.assign(entry, await measure(page));
    entry.axe = await axeOf(page);
    entry.consoleErrors = [];
    await page.screenshot({ path: `${OUT}/loading_state.png`, fullPage: true });
    await jpeg(page, "loading_state");
  } catch (e) { entry.error = String(e).split("\n")[0]; }
  await fetch(`${MOCK}/__delay?ms=0`);
  report.push(entry);
  await page.close();
}

await browser.close();
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
try { writeFileSync(`${OUT}/mock-log.json`, await (await fetch(`${MOCK}/__log`)).text()); } catch {}

// Penilaian: kunci temuan (scripts/qa/mobile-360-keys.mjs). Kunci fatal (load, status:*) tidak pernah bisa di-baseline.
let fails = 0;
for (const r of report) {
  const keys = keysOf(r);
  const { fresh, stale } = classify(keys, BASELINE[r.label]);
  if (fresh.length) fails++;
  const verdict = fresh.length ? `FAIL (baru): ${fresh.slice(0, 6).join("; ")}${fresh.length > 6 ? ` (+${fresh.length - 6})` : ""}` : keys.length ? "PASS (hanya temuan baseline)" : "PASS";
  console.log(`\n## ${r.label} ${r.route} -> ${r.finalUrl ?? "-"} [${r.status ?? "-"}] ${verdict}`);
  // Satu baris mesin-terbaca per halaman (untuk membangun baseline dari lari CI nyata).
  console.log(`KEYS ${r.label} ${JSON.stringify(keys)}`);
  if (r.error) { console.log(`   ${r.error}`); continue; }
  console.log(`   w=${r.innerWidth} targets=${r.targetCount} h1=${r.h1} title="${r.title}" consoleErrors=${JSON.stringify(r.consoleErrors)}`);
  if (fresh.some(isFatalKey)) console.log(`   FATAL: halaman wajib tidak termuat dengan benar; tidak dapat diterima baseline.`);
  if (stale.length) console.log(`   baseline usang (sudah tidak muncul, hapus dari baseline): ${JSON.stringify(stale)}`);
  if (r.unlabeledInfo?.length) console.log(`   unlabeled: ${JSON.stringify(r.unlabeledInfo)}`);
  if (r.offenders.length) console.log(`   overflow candidates: ${JSON.stringify(r.offenders)}`);
}
console.log(`\nSUMMARY pages=${report.length} failing_new=${fails}`);
process.exit(fails ? 1 : 0);
