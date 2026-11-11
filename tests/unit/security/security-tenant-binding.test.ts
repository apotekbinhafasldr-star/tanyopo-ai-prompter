// @vitest-environment node
/**
 * QA/Security (2026-11-11) — tenant binding of server actions and routes.
 *
 *  1. No browser-reachable code reads a tenant id from the request (form field, query string, JSON body). The tenant
 *     always comes from the session (requireSessionContext / fn_current_tenant_id).
 *  2. The ONLY place a tenant id is accepted from a caller is the HMAC-signed UMKMpro service API (schemas/umkmpro.ts).
 *     That is a server-to-server trust decision: whoever holds UMKMPRO_SERVICE_TOKEN can address any tenant (SEC-06).
 *  3. Every exported server action authenticates before it does anything, except the three pre-login ones.
 *
 * Label: CODE + UNIT TEST. Static source inspection only (approximate by design: it splits a file at each
 * `export async function`, so it proves "a session marker appears in the function's text", not full data-flow).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function walk(dir: string, accept: (rel: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (name === "node_modules" || name === ".next") continue;
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, accept, out);
    else if (accept(rel)) out.push(rel);
  }
  return out;
}

const isSource = (rel: string) => /\.(ts|tsx)$/.test(rel);

describe("security: no tenant id is read from the request", () => {
  const FROM_REQUEST = /(formData|searchParams|params|query)\.get(All)?\(\s*["'`](tenant|tenant_id|tenantId|tenantID)["'`]/;
  const files = [...walk("features", isSource), ...walk("app", isSource), ...walk("lib", isSource), ...walk("services", isSource)];

  it("scans a non-trivial number of files", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("no formData / searchParams read of a tenant key anywhere in features, app, lib or services", () => {
    const offenders = files.filter((f) => FROM_REQUEST.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("the only zod schema that declares a tenant id is the HMAC-protected UMKMpro one", () => {
    const schemaFiles = walk("schemas", isSource).filter((f) => /tenant_?id/i.test(read(f)));
    expect(schemaFiles).toEqual(["schemas/umkmpro.ts"]);
  });

  it("only the UMKMpro HMAC routes take tenantId from a parsed body", () => {
    const routes = walk("app", (f) => f.endsWith("route.ts")).filter((f) => /parsed\.data\.tenantId|const \{ tenantId[^}]*\} = parsed\.data/.test(read(f)));
    expect(routes.sort()).toEqual([
      "app/api/v1/integrations/umkmpro/conversions/route.ts",
      "app/api/v1/integrations/umkmpro/products/route.ts",
      "app/api/v1/integrations/umkmpro/promotions/route.ts",
      "app/api/v1/integrations/umkmpro/webhooks/route.ts",
    ]);
  });
});

describe("security: every exported server action authenticates first", () => {
  const AUTH_MARKER =
    /requireSessionContext\(|requireOwner|authorize\(\)|currentTenantId\(\)|auth\.getUser\(|requireAdminPermission\(|getPaymentOperator\(|verifyDemoSessionToken\(|requireDemoSession|getDemoSession/;
  /** Pre-login actions: they cannot require a session. */
  const PRE_AUTH = new Set(["loginAction", "logoutAction", "forgotPasswordAction"]);

  const actionFiles = [
    ...walk("features", (f) => /(^|\/)[\w-]*actions\.ts$/.test(f)),
    ...walk("app", (f) => /(^|\/)[\w-]*actions\.ts$/.test(f)),
  ].filter((f) => /^\s*"use server"/m.test(read(f)));

  it("finds the action files", () => {
    expect(actionFiles.length).toBeGreaterThanOrEqual(20);
  });

  it("each exported async function contains a session / permission marker (or is one of the pre-login actions)", () => {
    const missing: string[] = [];
    for (const file of actionFiles) {
      const parts = read(file).split(/^(?=export async function )/m).slice(1);
      for (const part of parts) {
        const name = /^export async function (\w+)/.exec(part)?.[1] ?? "?";
        if (PRE_AUTH.has(name)) continue;
        if (!AUTH_MARKER.test(part)) missing.push(`${file}#${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("the pre-login exemption list is exactly the three login-flow actions and lives in features/auth/actions.ts", () => {
    const names = new Set<string>();
    for (const file of actionFiles) {
      for (const m of read(file).matchAll(/^export async function (\w+)/gm)) if (PRE_AUTH.has(m[1])) names.add(`${file}#${m[1]}`);
    }
    expect([...names].sort()).toEqual([
      "features/auth/actions.ts#forgotPasswordAction",
      "features/auth/actions.ts#loginAction",
      "features/auth/actions.ts#logoutAction",
    ]);
  });
});

describe("security: service-role (RLS-bypassing) reads of credentials are tenant-filtered", () => {
  it("every admin-client query on prompter_oauth_credentials in features/ and lib/connectors names a tenant", () => {
    const files = [...walk("features", isSource), ...walk("lib/connectors", isSource)];
    const offenders: string[] = [];
    for (const f of files) {
      const src = read(f);
      for (const m of src.matchAll(/\badmin\w*\s*\.from\("prompter_oauth_credentials"\)([\s\S]*?);/g)) {
        if (!/tenant_id|tenantId/.test(m[0])) offenders.push(`${f}:${src.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
