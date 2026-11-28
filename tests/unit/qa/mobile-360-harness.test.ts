import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

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
