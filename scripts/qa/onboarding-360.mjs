// Mobile gate PR #145: Chromium 360px, 8 langkah onboarding, terhadap build lokal di runner CI (tanpa Supabase/Netlify nyata).
// Backend = scripts/qa/mock-supabase.mjs (fixture lokal). Aplikasi tidak punya bypass uji.
import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { USERS } from "./mock-supabase.mjs";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
if (!/^http:\/\/localhost(:\d+)?$/.test(BASE)) throw new Error("QA hanya untuk localhost");
const OUT = "qa-output";
mkdirSync(`${OUT}/jpg`, { recursive: true });
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const HEADINGS = {
  1: "Apa nama bisnis Anda?",
  2: "Pasar & Preferensi Global",
  3: "Apa jenis bisnis Anda?",
  4: "Apa yang Anda jual?",
  5: "Apa tujuan utama Anda?",
  6: "Target Pasar Campaign (opsional)",
  7: "Tambahkan produk pertama Anda",
  8: "Hubungkan channel marketing",
};

const b64u = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
function sessionCookie(user) {
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const token = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub: user.id, aud: "authenticated", role: "authenticated", exp })}.sig`;
  const session = { access_token: token, token_type: "bearer", expires_in: 86400, expires_at: exp, refresh_token: "qa-refresh", user: { id: user.id, email: user.email, aud: "authenticated" } };
  return { name: "sb-localhost-auth-token", value: "base64-" + b64u(session), domain: "localhost", path: "/", httpOnly: false, sameSite: "Lax" };
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA });
await ctx.addCookies([sessionCookie(USERS.newbie)]);
const page = await ctx.newPage();
page.setDefaultTimeout(20000);
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 140)));
const posts = [];
page.on("request", (r) => { if (r.method() === "POST" && r.url().startsWith(BASE)) posts.push(r.url().replace(BASE, "")); });

const next = () => page.getByRole("button", { name: /Lanjut/ });
const back = () => page.getByRole("button", { name: /Kembali/ });
const heading = async () => (await page.locator("h2:visible").first().textContent())?.trim() ?? "";
const focusInfo = () => page.evaluate(() => { const e = document.activeElement; return e ? `${e.tagName}${(e.textContent || e.getAttribute("aria-label") || "").trim() ? ` "${(e.textContent || e.getAttribute("aria-label")).trim().slice(0, 30)}"` : ""}` : "none"; });
async function expectStep(n) {
  await page.waitForFunction((t) => [...document.querySelectorAll("h2")].some((h) => h.textContent.trim() === t), HEADINGS[n]);
}

async function measure() {
  return page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
    const doc = document.documentElement;
    const name = (el) => (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || el.id || el.tagName).trim().slice(0, 32);
    const targets = [...document.querySelectorAll("button, input:not([type=hidden]), select, textarea, a[href]")].filter(vis).map((e) => { const r = e.getBoundingClientRect(); return { el: e.tagName.toLowerCase(), name: name(e), w: Math.round(r.width), h: Math.round(r.height) }; });
    const unlabeled = [...document.querySelectorAll("input:not([type=hidden]), select, textarea")].filter(vis).filter((e) => !(e.getAttribute("aria-label") || e.getAttribute("aria-labelledby") || (e.id && document.querySelector(`label[for="${e.id}"]`)) || e.closest("label"))).map((e) => `${e.tagName.toLowerCase()}#${e.id}`);
    const unnamed = [...document.querySelectorAll("button")].filter(vis).filter((e) => !(e.textContent || e.getAttribute("aria-label") || "").trim()).length;
    const offenders = [...document.querySelectorAll("body *")].filter((e) => vis(e) && e.getBoundingClientRect().right > doc.clientWidth + 1 && !e.closest("[class*=overflow]")).slice(0, 4).map((e) => e.tagName.toLowerCase() + "." + String(e.className).slice(0, 40));
    return { innerWidth, overflowX: doc.scrollWidth - doc.clientWidth, offenders, targets, unlabeled, unnamed, lewati: !!([...document.querySelectorAll("button")].find((b) => /Lewati/.test(b.textContent))) };
  });
}

async function shot(label) {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.screenshot({ path: `${OUT}/jpg/${label}.jpg`, type: "jpeg", quality: 55, scale: "css", fullPage: true, clip: { x: 0, y: 0, width: 360, height: Math.min(h, 1100) } });
}

const results = [];
let lastBackForward = "";
async function auditStep(n) {
  await expectStep(n);
  const m = await measure();
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  const hi = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const lo = axe.violations.filter((v) => !(v.impact === "serious" || v.impact === "critical"));
  const t24 = m.targets.filter((t) => t.h < 24 || t.w < 24);
  const t44 = m.targets.filter((t) => t.h < 44 || t.w < 44);
  const problems = [];
  if ((await heading()) !== HEADINGS[n]) problems.push(`heading "${await heading()}"`);
  if (m.innerWidth !== 360) problems.push(`viewport ${m.innerWidth}`);
  if (m.overflowX > 0) problems.push(`overflowX ${m.overflowX}px ${JSON.stringify(m.offenders)}`);
  if (hi.length) problems.push(`axe serious/critical: ${hi.map((v) => `${v.id}(${v.nodes.length})`).join(",")}`);
  if (t24.length) problems.push(`target<24px: ${t24.map((t) => `${t.name} ${t.w}x${t.h}`).join("; ")}`);
  if (m.unlabeled.length) problems.push(`input tanpa label: ${m.unlabeled.join(",")}`);
  if (m.unnamed) problems.push(`${m.unnamed} tombol tanpa nama`);
  if (n >= 7 && !m.lewati) problems.push("'Lewati' tidak tampil di langkah >=7");
  if (n < 7 && m.lewati) problems.push("'Lewati' tampil sebelum langkah 7");
  if (posts.length !== (n === 8 ? 0 : 0)) problems.push(`POST sebelum langkah 8 selesai: ${posts.join(",")}`);
  await shot(`step${n}`);
  results.push({ n, problems, axeLow: lo.map((v) => `${v.impact}:${v.id}`), small44: t44.map((t) => `${t.name} ${t.w}x${t.h}`), targets: m.targets.length });
}

await page.goto(BASE + "/onboarding", { waitUntil: "networkidle", timeout: 45000 });
posts.length = 0;
const keyboard = [];

// ---- langkah 1 ----
await auditStep(1);
const s1 = results[0];
if (!(await next().isDisabled())) s1.problems.push("Lanjut aktif padahal nama kosong");
if (!(await page.locator("[role=status]").filter({ hasText: "Isi nama bisnis" }).count())) s1.problems.push("hint validasi tidak tampil");
await page.locator("#brandNameInput").fill("K");
if (!(await next().isDisabled())) s1.problems.push("Lanjut aktif untuk 1 karakter");
await page.locator("#brandNameInput").fill("Kopi Nusantara");
if (await next().isDisabled()) s1.problems.push("Lanjut tetap nonaktif untuk nama valid");
// Enter di kolom nama: harus maju (bukan mengirim form)
await page.locator("#brandNameInput").press("Enter");
try { await expectStep(2); keyboard.push("Enter di kolom nama langkah 1 -> pindah ke langkah 2 tanpa submit"); } catch { s1.problems.push("Enter tidak memajukan ke langkah 2"); }
if (posts.length) s1.problems.push(`Enter memicu POST: ${posts.join(",")}`);
await back().click();
await expectStep(1);
if ((await page.locator("#brandNameInput").inputValue()) !== "Kopi Nusantara") s1.problems.push("nama hilang setelah Kembali");
await next().click();

const requires = {
  3: async () => { await page.locator("button[aria-pressed]").first().click(); },
  4: async () => { await page.locator("textarea").fill("Kopi kemasan siap seduh dari petani lokal."); },
  5: async () => { await page.locator("button[aria-pressed]").first().click(); },
};
// ---- langkah 2..7 ----
for (let n = 2; n <= 7; n++) {
  await auditStep(n);
  const r = results[n - 1];
  const needs = n in requires;
  if (needs) {
    if (!(await next().isDisabled())) r.problems.push("Lanjut aktif sebelum pilihan/isian wajib");
    if (!(await page.locator("[role=status]").count())) r.problems.push("hint validasi tidak tampil");
    await requires[n]();
  }
  if (await next().isDisabled()) r.problems.push("Lanjut nonaktif padahal syarat terpenuhi");
  // Kembali lalu maju lagi
  await back().click();
  try { await expectStep(n - 1); await next().click(); await expectStep(n); } catch { r.problems.push("Kembali/Lanjut tidak konsisten"); }
  if (n === 7) {
    // pengguna keyboard: fokus ke Lanjut lalu Enter
    await next().focus();
    await page.keyboard.press("Enter");
    keyboard.push("Enter pada tombol Lanjut di langkah 7");
  } else {
    await next().click();
  }
  lastBackForward = await focusInfo();
  r.focusAfterNext = lastBackForward;
}

// ---- langkah 8 ----
await auditStep(8);
const r8 = results[7];
r8.focusAfterNext = await focusInfo();
if (!/Selesai/.test(r8.focusAfterNext)) r8.problems.push(`fokus di langkah 8 bukan Selesai: ${r8.focusAfterNext}`);
if (posts.length) r8.problems.push(`form terkirim sebelum Selesai diklik: ${posts.join(",")}`);
if (await page.getByRole("button", { name: /Lanjut/ }).count()) r8.problems.push("Lanjut masih tampil di langkah 8");
const finish = page.getByRole("button", { name: "Selesai, ke Dashboard" });
if ((await finish.getAttribute("type")) !== "submit") r8.problems.push("tombol Selesai bukan submit");
await finish.click();
await page.waitForTimeout(2500);
const submitCount = posts.length;
if (submitCount !== 1) r8.problems.push(`jumlah POST setelah satu klik Selesai = ${submitCount} (harus 1)`);
await shot("step8_after_submit");
const alertText = (await page.locator("[role=alert]").first().textContent().catch(() => null)) ?? "-";
await browser.close();

writeFileSync(`${OUT}/onboarding-report.json`, JSON.stringify({ results, keyboard, submitCount, alertText, consoleErrors }, null, 2));
let fails = 0;
for (const r of results) {
  if (r.problems.length) fails++;
  console.log(`STEP ${r.n} ${HEADINGS[r.n]} => ${r.problems.length ? "FAIL: " + r.problems.join(" | ") : "PASS"}`);
  console.log(`   targets=${r.targets} focusAfterNext=${r.focusAfterNext ?? "-"} axeNonCritical=${JSON.stringify(r.axeLow)}`);
  if (r.small44.length) console.log(`   NOTE target<44px: ${r.small44.slice(0, 6).join("; ")}`);
}
for (const k of keyboard) console.log(`KEYBOARD: ${k}`);
console.log(`SUBMIT: POST setelah satu klik Selesai = ${submitCount}; respons mock (RPC kosong): "${alertText.trim().slice(0, 80)}"`);
console.log(`CONSOLE_ERRORS=${JSON.stringify(consoleErrors.slice(0, 3))}`);
console.log(`SUMMARY steps=8 failing=${fails}`);
process.exit(fails ? 1 : 0);
