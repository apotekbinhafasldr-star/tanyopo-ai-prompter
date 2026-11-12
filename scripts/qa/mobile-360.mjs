// QA mobile 360px (read-only against a locally started production build; no network to Supabase/Netlify).
import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const OUT = "qa-output";
mkdirSync(OUT, { recursive: true });
const ROUTES = ["/", "/login", "/register", "/forgot-password", "/privacy", "/terms", "/demo", "/demo/dashboard", "/demo/products", "/demo/campaign", "/demo/content", "/demo/analytics"];
const MIN = 44;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const report = [];
for (const route of ROUTES) {
  const page = await ctx.newPage();
  const entry = { route };
  try {
    const res = await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 45000 });
    entry.status = res?.status();
    entry.finalUrl = page.url().replace(BASE, "");
    await page.waitForTimeout(500);
    const m = await page.evaluate((MIN) => {
      const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
      const name = (el) => (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || el.getAttribute("name") || el.tagName).trim().slice(0, 40);
      const doc = document.documentElement;
      const overflowX = doc.scrollWidth - doc.clientWidth;
      const offenders = [...document.querySelectorAll("body *")].filter((e) => vis(e) && e.getBoundingClientRect().right > doc.clientWidth + 1).slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 40)}`);
      const targets = [...document.querySelectorAll("button, input:not([type=hidden]), select, textarea, [role=button], nav a, header a, aside a, a.btn")].filter(vis);
      const small = targets.map((e) => { const r = e.getBoundingClientRect(); return { el: e.tagName.toLowerCase(), name: name(e), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((t) => t.h < MIN || t.w < MIN);
      const unnamedButtons = [...document.querySelectorAll("button, [role=button]")].filter((e) => vis(e) && !name(e).replace(e.tagName, "")).length;
      const inputsNoLabel = [...document.querySelectorAll("input:not([type=hidden]), select, textarea")].filter((e) => vis(e) && !(e.getAttribute("aria-label") || e.getAttribute("aria-labelledby") || (e.id && document.querySelector(`label[for="${CSS.escape(e.id)}"]`)) || e.closest("label"))).length;
      return { overflowX, offenders, targetCount: targets.length, small, unnamedButtons, inputsNoLabel, lang: doc.lang, h1: document.querySelectorAll("h1").length };
    }, MIN);
    Object.assign(entry, m);
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    entry.axe = axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(" ") }));
    await page.screenshot({ path: `${OUT}/${route.replace(/\W+/g, "_") || "root"}.png`, fullPage: true });
  } catch (e) {
    entry.error = String(e).split("\n")[0];
  }
  report.push(entry);
  await page.close();
}
await browser.close();
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
for (const r of report) {
  console.log(`\n## ${r.route} -> ${r.finalUrl ?? "-"} status=${r.status ?? "-"} ${r.error ? "ERROR " + r.error : ""}`);
  if (r.error) continue;
  console.log(`overflowX=${r.overflowX}px offenders=${JSON.stringify(r.offenders)} targets=${r.targetCount} small(<${MIN}px)=${r.small.length} unnamedButtons=${r.unnamedButtons} inputsNoLabel=${r.inputsNoLabel} lang=${r.lang} h1=${r.h1}`);
  for (const s of r.small.slice(0, 8)) console.log(`  small: ${s.el} "${s.name}" ${s.w}x${s.h}`);
  for (const a of r.axe) console.log(`  axe ${a.impact} ${a.id} x${a.nodes} ${a.sample}`);
}
const bad = report.filter((r) => r.error || r.overflowX > 0);
console.log(`\nSUMMARY routes=${report.length} overflow_or_error=${bad.length}`);
// Findings are REPORTED, not hidden. Fail only on a horizontal overflow or a page that could not be loaded.
process.exit(bad.length ? 1 : 0);
