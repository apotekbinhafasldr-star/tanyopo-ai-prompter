// QA mobile 360px. Runs ONLY against a locally started production build on the CI runner.
// Login-gated screens use scripts/qa/mock-supabase.mjs (a fake backend on the runner); the app has no test bypass.
import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { USERS } from "./mock-supabase.mjs";

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
    const small = targets.map((e) => { const r = e.getBoundingClientRect(); return { el: e.tagName.toLowerCase(), name: name(e), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((t) => t.h < MIN || t.w < MIN);
    const unnamedButtons = [...document.querySelectorAll("button, [role=button]")].filter((e) => vis(e) && !name(e).replace(e.tagName, "")).length;
    const inputsNoLabel = [...document.querySelectorAll("input:not([type=hidden]), select, textarea")].filter((e) => vis(e) && !(e.getAttribute("aria-label") || e.getAttribute("aria-labelledby") || (e.id && document.querySelector(`label[for="${CSS.escape(e.id)}"]`)) || e.closest("label"))).length;
    return { innerWidth: innerWidth, overflowX: doc.scrollWidth - doc.clientWidth, offenders, targetCount: targets.length, small, unnamedButtons, inputsNoLabel, lang: doc.lang, h1: document.querySelectorAll("h1").length, title: document.title };
  }, MIN);
}

const report = [];
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
    Object.assign(entry, await measure(page));
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    entry.axe = axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(" ") }));
    entry.consoleErrors = consoleErrors.slice(0, 3);
    await page.screenshot({ path: `${OUT}/${label}.png`, fullPage: true });
  } catch (e) { entry.error = String(e).split("\n")[0]; }
  report.push(entry);
  await page.close();
  return entry;
}

// 1) public pages
const pub = await mk();
for (const r of ["/", "/login", "/register", "/forgot-password", "/privacy", "/terms", "/refund", "/data-deletion"]) await audit(pub, `public_${r.replace(/\W+/g, "") || "root"}`, r);

// 2) demo: a real navigation to /api/demo/start (needs DEMO_SESSION_SECRET in the runner's server env)
const demo = await mk();
await audit(demo, "demo_entry", "/api/demo/start");
for (const r of ["/demo/dashboard", "/demo/products", "/demo/campaign", "/demo/content", "/demo/analytics"]) await audit(demo, `demo_${r.split("/").pop()}`, r);

// 3) login-gated screens (fixture session)
const authed = await mk([sessionCookie(USERS.complete)]);
for (const r of ["/dashboard", "/connections", "/billing", "/campaigns", "/products", "/content", "/analytics", "/settings"]) await audit(authed, `app_${r.slice(1)}`, r);
const fresh = await mk([sessionCookie(USERS.newbie)]);
await audit(fresh, "onboarding", "/onboarding");

// 4) loading state: slow the fake backend, capture the route-segment skeleton
await fetch(`${MOCK}/__delay?ms=4000`);
await audit(authed, "loading_dashboard", "/dashboard", {
  wait: "commit",
  afterNav: async (p) => { await p.waitForSelector("[role=status][aria-busy=true]", { timeout: 8000 }); },
});
await fetch(`${MOCK}/__delay?ms=0`);

await browser.close();
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
try { writeFileSync(`${OUT}/mock-log.json`, await (await fetch(`${MOCK}/__log`)).text()); } catch {}

let fails = 0;
for (const r of report) {
  const problems = [];
  if (r.error) problems.push("LOAD " + r.error);
  else {
    if (r.innerWidth !== 360) problems.push(`viewport ${r.innerWidth}`);
    if (r.overflowX > 0) problems.push(`overflowX ${r.overflowX}px`);
    if (r.small.length) problems.push(`${r.small.length} target<44`);
    if (r.unnamedButtons) problems.push(`${r.unnamedButtons} unnamed buttons`);
    if (r.inputsNoLabel) problems.push(`${r.inputsNoLabel} inputs w/o label`);
    const hi = r.axe.filter((a) => a.impact === "serious" || a.impact === "critical");
    if (hi.length) problems.push(`${hi.length} axe serious/critical`);
  }
  if (problems.length) fails++;
  console.log(`\n## ${r.label} ${r.route} -> ${r.finalUrl ?? "-"} [${r.status ?? "-"}] ${problems.length ? "FAIL: " + problems.join("; ") : "PASS"}`);
  if (r.error) continue;
  console.log(`   w=${r.innerWidth} targets=${r.targetCount} h1=${r.h1} title="${r.title}" consoleErrors=${JSON.stringify(r.consoleErrors)}`);
  if (r.offenders.length) console.log(`   overflow candidates: ${JSON.stringify(r.offenders)}`);
  for (const s of r.small.slice(0, 8)) console.log(`   small: ${s.el} "${s.name}" ${s.w}x${s.h}`);
  for (const a of r.axe) console.log(`   axe ${a.impact} ${a.id} x${a.nodes} ${a.sample}`);
}
console.log(`\nSUMMARY pages=${report.length} failing=${fails}`);
process.exit(fails ? 1 : 0);
