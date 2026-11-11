import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LIMITS, SAFE_PATHS, hostMatches, parseAllowlist, parseLimits, validateBaseUrl } from "../../load/lib/allowlist.js";

// Hanya logika murni + pengecekan teks berkas. Tidak ada request jaringan, tidak menjalankan k6.
const LOAD_DIR = path.resolve(__dirname, "../../load");
const LIST = [
  "# komentar",
  "",
  "linoe-sandbox.netlify.app",
  "deploy-preview-*--linoe-sandbox.netlify.app",
  "!linoe-sandbox-prod.netlify.app",
].join("\n");

function reason(url: string | undefined, list = LIST): string {
  const r = validateBaseUrl(url, list);
  return r.ok ? "" : r.reason;
}

describe("parseAllowlist", () => {
  it("mengabaikan komentar dan baris kosong, memisahkan allow dan larangan", () => {
    expect(parseAllowlist(LIST)).toEqual({
      allow: ["linoe-sandbox.netlify.app", "deploy-preview-*--linoe-sandbox.netlify.app"],
      deny: ["linoe-sandbox-prod.netlify.app"],
    });
  });

  it.each([
    ["domain bukan Netlify", "contoh-sandbox.example.com"],
    ["bintang saja", "*.netlify.app"],
    ["terlalu pendek / situs milik orang lain", "sandbox.netlify.app"],
    ["tanpa penanda sandbox", "linoe-produksi.netlify.app"],
    ["huruf besar", "Linoe-Sandbox.netlify.app"],
    ["subdomain berlapis", "a.linoe-sandbox.netlify.app"],
    ["terlalu banyak bintang", "*a*-*b*-linoe-sandbox.netlify.app"],
  ])("menolak pola tidak valid: %s", (_name, line) => {
    expect(() => parseAllowlist(line)).toThrow(/tidak valid/);
  });

  it("pola larangan tidak wajib memuat penanda", () => {
    expect(parseAllowlist("!linoe-produksi.netlify.app").deny).toEqual(["linoe-produksi.netlify.app"]);
  });
});

describe("hostMatches", () => {
  it("bintang tidak pernah mewakili titik", () => {
    expect(hostMatches("deploy-preview-12--linoe-sandbox.netlify.app", "deploy-preview-*--linoe-sandbox.netlify.app")).toBe(true);
    expect(hostMatches("a.b--linoe-sandbox.netlify.app", "*--linoe-sandbox.netlify.app")).toBe(false);
    expect(hostMatches("linoe-sandbox.netlify.app.evil.com", "linoe-sandbox.netlify.app")).toBe(false);
    expect(hostMatches("xlinoe-sandbox.netlify.app", "linoe-sandbox.netlify.app")).toBe(false);
  });
});

describe("validateBaseUrl", () => {
  it("menerima host yang ada di allowlist (dengan atau tanpa slash akhir, huruf besar dinormalkan)", () => {
    expect(validateBaseUrl("https://linoe-sandbox.netlify.app", LIST)).toEqual({
      ok: true,
      origin: "https://linoe-sandbox.netlify.app",
      host: "linoe-sandbox.netlify.app",
    });
    expect(validateBaseUrl("https://LINOE-SANDBOX.netlify.app/", LIST).ok).toBe(true);
    expect(validateBaseUrl("https://deploy-preview-12--linoe-sandbox.netlify.app", LIST).ok).toBe(true);
  });

  it("menolak BASE_URL kosong / tidak ada", () => {
    expect(reason(undefined)).toMatch(/wajib/);
    expect(reason("   ")).toMatch(/wajib/);
  });

  it("menolak localhost, alamat IP, dan host produksi/tak dikenal", () => {
    for (const u of [
      "https://localhost",
      "https://127.0.0.1",
      "https://[::1]",
      "https://linoe.id",
      "https://umkmpro-ai.supabase.co",
      "https://evil.com",
    ]) {
      expect(validateBaseUrl(u, LIST).ok, u).toBe(false);
    }
  });

  it("menolak http, userinfo, port, path, query, fragment", () => {
    for (const u of [
      "http://linoe-sandbox.netlify.app",
      "https://linoe-sandbox.netlify.app@evil.com",
      "https://evil.com\\@linoe-sandbox.netlify.app",
      "https://linoe-sandbox.netlify.app:8443",
      "https://linoe-sandbox.netlify.app/api/health",
      "https://linoe-sandbox.netlify.app/?a=1",
      "https://linoe-sandbox.netlify.app/#x",
    ]) {
      expect(validateBaseUrl(u, LIST).ok, u).toBe(false);
    }
  });

  it("menolak host tipuan (sufiks/prefiks/subdomain)", () => {
    for (const u of [
      "https://linoe-sandbox.netlify.app.evil.com",
      "https://evil-linoe-sandbox.netlify.app",
      "https://x.deploy-preview-1--linoe-sandbox.netlify.app",
    ]) {
      expect(validateBaseUrl(u, LIST).ok, u).toBe(false);
    }
  });

  it("larangan (!) menang atas allow", () => {
    const list = "linoe-sandbox-*.netlify.app\n!linoe-sandbox-prod.netlify.app";
    expect(reason("https://linoe-sandbox-prod.netlify.app", list)).toMatch(/larangan/);
    expect(validateBaseUrl("https://linoe-sandbox-uji.netlify.app", list).ok).toBe(true);
  });

  it("allowlist kosong atau rusak = tolak semuanya", () => {
    expect(reason("https://linoe-sandbox.netlify.app", "# kosong\n")).toMatch(/kosong/);
    expect(reason("https://linoe-sandbox.netlify.app", "linoe.netlify.app")).toMatch(/tidak valid/);
  });
});

describe("parseLimits", () => {
  it("memakai default kecil bila tidak diisi", () => {
    expect(parseLimits({})).toEqual({ vus: LIMITS.defaultVus, durationSeconds: LIMITS.defaultDurationSeconds });
    expect(parseLimits(undefined).vus).toBe(2);
  });

  it("menerima nilai di dalam batas", () => {
    expect(parseLimits({ VUS: "10", DURATION_SECONDS: "120" })).toEqual({ vus: 10, durationSeconds: 120 });
  });

  it.each([["0"], ["11"], ["-1"], ["2.5"], ["abc"], ["1e3"]])("menolak VUS=%s", (v) => {
    expect(() => parseLimits({ VUS: v })).toThrow();
  });

  it("menolak durasi di atas batas keras", () => {
    expect(() => parseLimits({ DURATION_SECONDS: "121" })).toThrow(/batas keras/);
  });
});

describe("berkas yang dikirim bersama repo", () => {
  it("allowlist.txt bawaan valid dan KOSONG (semua target ditolak sampai Founder mengisi)", () => {
    const text = readFileSync(path.join(LOAD_DIR, "allowlist.txt"), "utf8");
    expect(parseAllowlist(text)).toEqual({ allow: [], deny: [] });
    expect(reason("https://linoe-sandbox.netlify.app", text)).toMatch(/kosong/);
  });

  it("SAFE_PATHS: hanya jalur ringan tanpa query", () => {
    expect(SAFE_PATHS).toContain("/api/health");
    for (const p of SAFE_PATHS) {
      expect(p.startsWith("/")).toBe(true);
      expect(p).not.toMatch(/[?#]/);
    }
    expect(SAFE_PATHS.some((p) => p.startsWith("/api/") && p !== "/api/health")).toBe(false);
  });

  it("smoke.js: validasi sebelum options, hanya GET, tanpa kredensial, tanpa redirect", () => {
    const full = readFileSync(path.join(LOAD_DIR, "smoke.js"), "utf8");
    // Komentar dibuang agar penjelasan ("tanpa cookie") tidak dianggap kode.
    const src = full
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("/*"))
      .join("\n");
    expect(src.indexOf("validateBaseUrl(")).toBeGreaterThan(-1);
    expect(src.indexOf("validateBaseUrl(")).toBeLessThan(src.indexOf("export const options"));
    expect(src.indexOf("throw new Error")).toBeLessThan(src.indexOf("export const options"));
    expect(src).not.toMatch(/http\.(post|put|patch|del|delete|request|batch|asyncRequest)\s*\(/);
    expect(src).not.toMatch(/authorization|cookie|bearer|apikey|password|secret|token/i);
    expect(src).toMatch(/redirects:\s*0/);
  });
});
