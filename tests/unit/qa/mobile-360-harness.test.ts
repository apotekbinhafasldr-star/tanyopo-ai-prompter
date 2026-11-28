import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { axeKeys, checkSessionCookieAttrs, classify, isFatalKey, keysOf, normalizeSelector, validateBaseline } from "../../../scripts/qa/mobile-360-keys.mjs";

const root = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

const workflow = read(".github/workflows/qa-mobile-360.yml");
const harness = read("scripts/qa/mobile-360.mjs");
const mock = read("scripts/qa/mock-supabase.mjs");
const baseline = JSON.parse(read("scripts/qa/mobile-360-baseline.json")) as {
  accepted: Record<string, { key: string; reason: string }[]>;
};

describe("harness QA mobile 360px: pagar keamanan (UNIT, analisis teks)", () => {
  it("workflow tanpa secret, tanpa deploy, tanpa Supabase produksi, izin hanya baca", () => {
    expect(workflow).not.toMatch(/secrets\./);
    expect(workflow).not.toMatch(/netlify|vercel|supabase\.co|migrat|db push/i);
    expect(workflow).toMatch(/permissions:\s*\n\s*contents: read/);
    expect(workflow).toContain("NEXT_PUBLIC_SUPABASE_URL: http://localhost:54321");
  });

  it("terpisah dari ci.yml dan tidak mengubah package.json (npm i --no-save)", () => {
    expect(workflow).toMatch(/npm i --no-save playwright@1\.49\.1 @axe-core\/playwright@4\.10\.1/);
    expect(workflow).not.toMatch(/\bnpm install\b/);
  });

  it("harness hanya berjalan ke localhost", () => {
    expect(harness).toMatch(/\^http:\\\/\\\/localhost\(:\\d\+\)\?\$/);
    expect(harness).toContain("QA runs against localhost only");
  });

  it("backend palsu hanya mendengarkan localhost-fixture, data sintetis (.test / example)", () => {
    expect(mock).not.toMatch(/https?:\/\/(?!localhost|x")[a-z0-9.-]+\.(co|com|io)/i);
    expect(mock).toMatch(/@example\.test/);
  });
});

describe("harness QA mobile 360px: cakupan layar (UNIT)", () => {
  it.each([
    "/promote",
    "/billing",
    "/connections",
    "/onboarding",
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "app_campaign_detail",
    "app_billing_confirm",
    "app_dashboard_drawer_open",
  ])("mencakup %s", (needle) => {
    expect(harness).toContain(needle);
  });

  it("data sintetis campaign dan produk milik tenant yang sama dengan pengguna QA", () => {
    expect(mock).toMatch(/prompter_master_campaigns:\s*\[\s*\{ id: C1, tenant_id: T1/);
    expect(mock).toMatch(/prompter_products:\s*\[\s*\{ id: P1, tenant_id: T1/);
  });
});

describe("baseline temuan (UNIT)", () => {
  it("setiap entri baseline punya kunci dan alasan tertulis", () => {
    for (const [label, entries] of Object.entries(baseline.accepted)) {
      expect(label).toMatch(/^[a-z0-9_]+$/);
      for (const e of entries) {
        expect(e.key.length).toBeGreaterThan(2);
        expect(e.reason.trim().length).toBeGreaterThan(10);
      }
    }
  });
});

describe("kunci temuan: halaman yang tidak termuat tidak pernah lulus (UNIT)", () => {
  const ok = { status: 200, innerWidth: 360, overflowX: 0, small: [], unnamedButtons: 0, inputsNoLabel: 0, axe: [] };

  it("galat muat menghasilkan kunci fatal 'load'", () => {
    expect(keysOf({ error: "page.goto: net::ERR_TOO_MANY_REDIRECTS" })).toEqual(["load"]);
    expect(isFatalKey("load")).toBe(true);
    expect(isFatalKey("status:500")).toBe(true);
    expect(isFatalKey("target<44:a:x")).toBe(false);
  });

  it("'load' tetap FAIL walau ada di baseline", () => {
    const { fresh } = classify(["load"], [{ key: "load", reason: "mencoba menerima halaman yang tidak termuat" }]);
    expect(fresh).toEqual(["load"]);
  });

  it("status bukan 2xx menjadi kunci fatal dan tidak bisa diterima baseline", () => {
    const keys = keysOf({ ...ok, status: 404 });
    expect(keys).toContain("status:404");
    expect(classify(keys, [{ key: "status:404", reason: "tidak sah diterima" }]).fresh).toContain("status:404");
  });

  it("pengalihan ke halaman lain tercatat sebagai temuan (bukan lulus diam-diam)", () => {
    expect(keysOf({ ...ok, requestedPath: "/demo/dashboard", finalPath: "/demo" })).toContain("redirect:/demo");
    expect(keysOf({ ...ok, requestedPath: "/login", finalPath: "/login" })).toEqual([]);
  });

  it("validateBaseline menolak kunci load/status dan entri tanpa alasan", () => {
    const errs = validateBaseline({
      accepted: {
        demo_dashboard: [{ key: "load", reason: "ERR_TOO_MANY_REDIRECTS diterima" }],
        x: [{ key: "status:500", reason: "server galat diterima" }],
        y: [{ key: "target<44:a:Logo", reason: "" }],
      },
    });
    expect(errs.some((e) => e.includes("demo_dashboard") && e.includes("load"))).toBe(true);
    expect(errs.some((e) => e.includes("status:500"))).toBe(true);
    expect(errs.some((e) => e.includes("tanpa alasan"))).toBe(true);
  });

  it("baseline di repo sah: tanpa kunci load/status dan tidak ada pengecualian untuk halaman demo", () => {
    expect(validateBaseline(baseline)).toEqual([]);
    for (const [label, entries] of Object.entries(baseline.accepted)) {
      for (const e of entries) expect(isFatalKey(e.key), `${label}:${e.key}`).toBe(false);
    }
    for (const l of ["demo_dashboard", "demo_products", "demo_campaign", "demo_content", "demo_analytics"]) {
      // Halaman demo boleh punya temuan UI lama, tetapi tidak boleh dikecualikan dari "termuat" atau "tidak dialihkan".
      for (const e of baseline.accepted[l] ?? []) expect(e.key, `${l}:${e.key}`).not.toMatch(/^(load|status:|redirect:)/);
    }
  });
});

describe("kunci axe sampai tingkat elemen (UNIT)", () => {
  const v = (id: string, impact: string, targets: string[]) => ({ id, impact, nodes: targets.length, targets });

  it("satu kunci per node pelanggaran serious/critical: axe:<aturan>:<selector>", () => {
    const keys = axeKeys([v("color-contrast", "serious", ["th:nth-child(1)", "th:nth-child(2)", ".a > p"]), v("region", "moderate", ["main"])]);
    expect(keys).toEqual(["axe:color-contrast:th:nth-child(1)", "axe:color-contrast:th:nth-child(2)", "axe:color-contrast:.a > p"]);
  });

  it("pelanggaran baru dengan aturan sama di elemen lain TIDAK tersembunyi oleh baseline", () => {
    const accepted = [{ key: "axe:color-contrast:th:nth-child(1)", reason: "temuan lama di main (th pertama)" }];
    const now = keysOf({ status: 200, innerWidth: 360, overflowX: 0, small: [], unnamedButtons: 0, inputsNoLabel: 0, axe: [v("color-contrast", "serious", ["th:nth-child(1)", ".tombol-baru"])] });
    const { fresh, stale } = classify(now, accepted);
    expect(fresh).toEqual(["axe:color-contrast:.tombol-baru"]);
    expect(stale).toEqual([]);
  });

  it("id dinamis dinormalkan dan selector panjang diberi hash stabil", () => {
    expect(normalizeSelector("#:r1a: > button")).toBe("#:id: > button");
    const long = "div > ".repeat(60) + "span";
    const a = normalizeSelector(long);
    expect(a.length).toBeLessThan(120);
    expect(a).toBe(normalizeSelector(long));
    expect(a).not.toBe(normalizeSelector(long + "x"));
  });

  it("harness mengumpulkan SEMUA node (bukan nodes[0]) dan tidak mencetak token/cookie/secret", () => {
    expect(harness).toContain("v.nodes.map(");
    expect(harness).not.toMatch(/nodes\[0\]/);
    expect(harness).toContain("mobile-360-keys.mjs");
    // Diagnostik demo: tidak ada console.log yang menyertakan variabel token/secret/cookie mentah.
    for (const line of harness.split("\n").filter((l) => l.includes("console.log"))) {
      expect(line, line).not.toMatch(/\$\{[^}]*(token|RUNNER_SECRET|sc\b|value)[^}]*\}/);
    }
  });

  it("secret demo sementara dibuat SEBELUM build (tanpa itu /demo/* ter-prerender statis dan looping)", () => {
    expect(workflow.indexOf("Ephemeral demo secret")).toBeGreaterThan(-1);
    expect(workflow.indexOf("Ephemeral demo secret")).toBeLessThan(workflow.indexOf("npm run build"));
    expect(workflow.indexOf("npm run build")).toBeLessThan(workflow.indexOf("name: Start app"));
  });

  it("workflow memask secret sementara demo dan tidak memakai secret repo", () => {
    expect(workflow).toContain("::add-mask::");
    expect(workflow).toContain('DEMO_SESSION_SECRET=$S" >> "$GITHUB_ENV"');
    expect(workflow).not.toMatch(/secrets\./);
  });
});

describe("FIX-203-FINAL (1): pengalihan tak terduga = FATAL, peta pengalihan eksplisit (UNIT)", () => {
  const ok = { status: 200, innerWidth: 360, overflowX: 0, small: [], unnamedButtons: 0, inputsNoLabel: 0, axe: [] };

  it("redirect:* fatal dan ditolak validateBaseline", () => {
    expect(isFatalKey("redirect:/login")).toBe(true);
    const errs = validateBaseline({ accepted: { app_dashboard: [{ key: "redirect:/login", reason: "mencoba menerima pengalihan" }] } });
    expect(errs.some((e) => e.includes("redirect:/login"))).toBe(true);
  });

  it("pengalihan tak terduga gagal walau ada entri baseline", () => {
    const keys = keysOf({ ...ok, requestedPath: "/dashboard", finalPath: "/login" }, {});
    expect(keys).toContain("redirect:/login");
    expect(classify(keys, [{ key: "redirect:/login", reason: "tidak boleh berlaku" }]).fresh).toContain("redirect:/login");
  });

  it("pengalihan yang terdaftar di peta lolos; tujuan lain untuk rute yang sama tetap gagal", () => {
    const map = { "/reset-password": "/login" };
    expect(keysOf({ ...ok, requestedPath: "/reset-password", finalPath: "/login" }, map)).toEqual([]);
    expect(keysOf({ ...ok, requestedPath: "/reset-password", finalPath: "/dashboard" }, map)).toContain("redirect:/dashboard");
    expect(keysOf({ ...ok, requestedPath: "/demo/dashboard", finalPath: "/demo" }, map)).toContain("redirect:/demo");
  });

  it("harness memakai peta eksplisit EXPECTED_REDIRECTS dan baseline tidak memuat redirect:*", () => {
    expect(harness).toContain("EXPECTED_REDIRECTS");
    expect(harness).toContain("keysOf(r, EXPECTED_REDIRECTS)");
    for (const entries of Object.values(baseline.accepted)) for (const e of entries) expect(e.key.startsWith("redirect:")).toBe(false);
  });
});

describe("FIX-203-FINAL (2): kelulusan demo hanya lewat sesi cookie ASLI (UNIT)", () => {
  const good = "linoe_demo_session=abc.1.2.def; Max-Age=1800; Path=/; HttpOnly; Secure; SameSite=lax";

  it("atribut keamanan lengkap lolos; tiap atribut yang hilang terdeteksi", () => {
    expect(checkSessionCookieAttrs(good)).toEqual([]);
    expect(checkSessionCookieAttrs(good.replace("; Secure", ""))).toEqual(["Secure"]);
    expect(checkSessionCookieAttrs(good.replace("; HttpOnly", ""))).toEqual(["HttpOnly"]);
    expect(checkSessionCookieAttrs(good.replace("; SameSite=lax", "; SameSite=none"))).toEqual(["SameSite=Lax"]);
    expect(checkSessionCookieAttrs(good.replace("; Path=/", ""))).toEqual(["Path=/"]);
    expect(checkSessionCookieAttrs(good.replace("; Max-Age=1800", ""))).toEqual(["Max-Age/Expires"]);
    expect(checkSessionCookieAttrs("")).toEqual(["cookie-tidak-ada"]);
    expect(checkSessionCookieAttrs(good.replace("Max-Age=1800", "Expires=Wed, 01 Jan 2031 00:00:00 GMT"))).toEqual([]);
  });

  it("masalah sesi asli = FATAL, tidak bisa di-baseline, dan menggagalkan walau jalur manual sukses", () => {
    const keys = keysOf({ label: "demo_session", sessionProblems: ["cookie-atribut-hilang:Secure"], status: 200, innerWidth: 360, overflowX: 0, small: [], axe: [] });
    expect(keys).toEqual(["demo-session:cookie-atribut-hilang:Secure"]);
    expect(isFatalKey(keys[0])).toBe(true);
    expect(classify(keys, [{ key: keys[0], reason: "tidak boleh berlaku" }]).fresh).toEqual(keys);
    expect(validateBaseline({ accepted: { demo_session: [{ key: keys[0], reason: "tidak boleh berlaku" }] } }).length).toBe(1);
    // sesi asli sehat => tidak ada temuan
    expect(keysOf({ status: 200, innerWidth: 360, overflowX: 0, small: [], axe: [], sessionProblems: [] })).toEqual([]);
  });

  it("harness: sesi asli lewat navigasi nyata; cookie manual hanya diagnostik berlabel dan tidak dipakai mengaudit", () => {
    expect(harness).toContain('page.goto(BASE + "/api/demo/start"');
    expect(harness).toContain("checkSessionCookieAttrs(setCookie)");
    expect(harness).toContain("DEMO-DIAG-MANUAL (hanya diagnostik; TIDAK membuat job lulus)");
    // audit halaman demo memakai context `demo` (jar dari sesi asli), bukan context hasil addCookies
    expect(harness).toMatch(/await audit\(demo, `demo_\$\{r\.split/);
    const afterManual = harness.slice(harness.indexOf("DEMO-DIAG-MANUAL"));
    expect(afterManual.indexOf("demo = ")).toBe(-1);
    // tidak ada pelonggaran atribut cookie aplikasi dari sisi harness
    expect(harness).not.toMatch(/secure:\s*false/i);
  });
});

describe("FIX-203-FINAL (3): backend palsu hanya di loopback (UNIT, analisis teks)", () => {
  it("setiap listen() punya host loopback; tidak ada 0.0.0.0 atau listen tanpa host", () => {
    const calls = [...mock.matchAll(/\.listen\(([^)]*?)(?:,\s*\(\)\s*=>|\))/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    for (const args of calls) expect(args, args).toMatch(/^54321,\s*"(127\.0\.0\.1|::1)"$/);
    expect(mock).not.toContain("0.0.0.0");
    expect(mock).toContain('"127.0.0.1"');
  });
});
