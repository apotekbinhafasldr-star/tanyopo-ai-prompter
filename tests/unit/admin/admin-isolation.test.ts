import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Static guards for Phase B: the Admin Center must not touch billing, payment
 * providers or the database directly, must contain no server actions or network
 * calls, and must hard-code no identity.
 */
const root = process.cwd();
const ADMIN_DIRS = ["app/admin", "features/admin", "lib/admin"];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(root, dir))) {
    const rel = path.join(dir, name);
    if (statSync(path.join(root, rel)).isDirectory()) out.push(...walk(rel));
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

const files = ADMIN_DIRS.flatMap(walk);
const code = (rel: string) =>
  readFileSync(path.join(root, rel), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|\s)\/\/.*$/, ""))
    .join("\n");

describe("admin center isolation", () => {
  it("finds the admin source files", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("imports nothing from billing, checkout, payment providers, webhooks or Supabase clients", () => {
    for (const f of files) {
      const src = code(f);
      expect(src, f).not.toMatch(/from\s+["'][^"']*(services\/billing|lib\/billing|services\/checkout|payment-webhook|payment-reconciliation|get-payment-provider|lib\/supabase|@supabase)/);
    }
  });

  it("has no server actions, no fetch/network calls and no environment access beyond the flag module", () => {
    for (const f of files) {
      const src = code(f);
      expect(src, f).not.toMatch(/["']use server["']/);
      expect(src, f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|axios/);
      if (!f.endsWith("lib/admin/flag.ts")) expect(src, f).not.toMatch(/process\.env/);
    }
  });

  it("hard-codes no email address and no tenant-role shortcut", () => {
    for (const f of files) {
      const src = code(f);
      expect(src, f).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
      expect(src, f).not.toMatch(/role\s*===?\s*["']owner["']|fn_current_role|requireSessionContext/);
    }
  });

  it("every page and the layout go through requireAdminPage", () => {
    for (const f of files.filter((p) => /^app\/admin\/(?:.*\/)?(page|layout)\.tsx$/.test(p))) {
      expect(code(f), f).toMatch(/requireAdminPage\(/);
    }
  });

  it("route handlers re-check the flag, the origin and a server-side permission (POST only)", () => {
    const routes = files.filter((p) => p.endsWith("/route.ts"));
    expect(routes.length).toBeGreaterThan(0);
    for (const f of routes) {
      const src = code(f);
      expect(src, f).toMatch(/isAdminCenterEnabled\(/);
      expect(src, f).toMatch(/requireAdminPermission\(/);
      expect(src, f).toMatch(/origin/);
      expect(src, f).toMatch(/export async function POST/);
      expect(src, f).not.toMatch(/export async function (GET|PUT|PATCH|DELETE)/);
    }
  });

  it("the Coretax package never logs in, files an SPT, pays tax or calls a DJP endpoint", () => {
    for (const f of [...files, "lib/coretax/package.ts", "lib/accounting/fiscal.ts"]) {
      const src = code(f);
      expect(src, f).not.toMatch(/coretax\.pajak\.go\.id|djponline|ereg|e-?filing|ntpn\s*=|bayar-?pajak/i);
    }
  });

  it("the shared proxy keeps /admin behind the normal login gate (not a public path)", () => {
    const proxy = readFileSync(path.join(root, "proxy.ts"), "utf-8");
    expect(proxy).not.toMatch(/["']\/admin/);
  });
});
