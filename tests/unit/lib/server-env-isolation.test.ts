import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * PR-B regression: server-only configuration (lib/env.server.ts) must never reach a browser bundle.
 *
 * The build-time protection is `import "server-only"`; these tests pin the structure that makes it
 * effective and fail if a Client Component can (transitively) import a server-only module or the
 * server env. They read SOURCE TEXT only: no environment variable is read and no value is printed.
 */
const root = path.resolve(__dirname, "../../..");
// Skipped at the repository root only (lib/supabase/ must stay in the graph).
const SKIP_ROOT = new Set(["tests", "supabase", "docs", "public"]);
const SKIP_ANYWHERE = new Set(["node_modules", ".next", ".git"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_ANYWHERE.has(name) || (dir === root && SKIP_ROOT.has(name))) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const files = walk(root);
const source = new Map(files.map((f) => [f, readFileSync(f, "utf-8")]));
const rel = (f: string) => path.relative(root, f);

function resolveImport(from: string, spec: string): string | null {
  let base: string | null = null;
  if (spec.startsWith("@/")) base = path.join(root, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  if (!base) return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) if (source.has(base + ext)) return base + ext;
  return null;
}

const imports = new Map<string, string[]>();
for (const f of files) {
  const code = stripComments(source.get(f)!);
  const specs = [...code.matchAll(/from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g)].map(
    (m) => m[1] ?? m[2] ?? m[3],
  );
  imports.set(f, specs.map((s) => resolveImport(f, s)).filter((x): x is string => x !== null));
}

const has = (f: string, re: RegExp) => re.test(stripComments(source.get(f)!));
const isClientModule = (f: string) => /^\s*["']use client["']/.test(source.get(f)!);
const isServerAction = (f: string) => /^\s*["']use server["']/.test(source.get(f)!);
const isServerOnly = (f: string) => has(f, /import\s+["']server-only["']/);

const envPublic = path.join(root, "lib/env.ts");
const envServer = path.join(root, "lib/env.server.ts");

describe("import graph sanity (the guards below are only meaningful if these files are in the graph)", () => {
  it("contains the env modules, the admin client, the browser client and at least one Client Component", () => {
    for (const f of ["lib/env.ts", "lib/env.server.ts", "lib/supabase/admin.ts", "lib/supabase/client.ts"]) {
      expect(source.has(path.join(root, f))).toBe(true);
    }
    expect(files.filter(isClientModule).length).toBeGreaterThan(10);
    expect(isClientModule(path.join(root, "lib/supabase/client.ts"))).toBe(true);
  });
});

describe("lib/env.ts (browser-safe) vs lib/env.server.ts (server-only)", () => {
  it("lib/env.server.ts starts with import \"server-only\"", () => {
    expect(source.get(envServer)!.trimStart().startsWith('import "server-only";')).toBe(true);
  });

  it("lib/env.ts never defines or mentions serverEnv or any server secret variable", () => {
    const code = stripComments(source.get(envPublic)!);
    expect(code).not.toMatch(/serverEnv/);
    expect(code).not.toMatch(/readOptional/);
    expect(code).not.toMatch(
      /SUPABASE_SECRET_KEY|TOKEN_ENCRYPTION_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|_APP_SECRET|CLIENT_SECRET|WEBHOOK_SECRET|SERVICE_TOKEN|PROCESSOR_SECRET|SESSION_SECRET|PAYMENT_PROVIDER_API_KEY/,
    );
  });

  it("lib/env.ts keeps the browser-safe exports", () => {
    const code = stripComments(source.get(envPublic)!);
    expect(code).toMatch(/export const publicEnv/);
    expect(code).toMatch(/export function isConnectorConfigured/);
  });

  it("no module imports serverEnv from the browser-safe lib/env", () => {
    const offenders = files.filter((f) => has(f, /import\s*\{[^}]*\bserverEnv\b[^}]*\}\s*from\s*["']@\/lib\/env["']/));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("only non-client modules import lib/env.server", () => {
    const importers = files.filter((f) => (imports.get(f) ?? []).includes(envServer));
    expect(importers.length).toBeGreaterThan(0);
    expect(importers.filter(isClientModule).map(rel)).toEqual([]);
  });
});

describe("client bundle cannot reach server-only code", () => {
  // A "use server" module is an RPC boundary: a Client Component receives a stub, never the module body.
  function reachableFromClient(): Map<string, string[]> {
    const seen = new Map<string, string[]>();
    for (const c of files.filter(isClientModule)) {
      const stack: [string, string[]][] = [[c, [c]]];
      while (stack.length) {
        const [node, trail] = stack.pop()!;
        if (node !== c && isServerAction(node)) continue; // RPC stub only: not part of the client bundle
        if (seen.has(node)) continue;
        seen.set(node, trail);
        for (const next of imports.get(node) ?? []) stack.push([next, [...trail, next]]);
      }
    }
    return seen;
  }

  it("no Client Component reaches lib/env.server.ts, the admin client or any `server-only` module", () => {
    const reach = reachableFromClient();
    const bad = [...reach.entries()]
      .filter(([f]) => f === envServer || f === path.join(root, "lib/supabase/admin.ts") || isServerOnly(f))
      .map(([f, trail]) => trail.map(rel).join(" -> ") + ` (${rel(f)})`);
    expect(bad).toEqual([]);
  });

  it("the only way a Client Component reaches lib/env.ts is through the browser Supabase client", () => {
    const reach = reachableFromClient();
    const direct = files.filter((f) => reach.has(f) && (imports.get(f) ?? []).includes(envPublic));
    expect(direct.map(rel)).toEqual(["lib/supabase/client.ts"]);
  });

  it("negative control: the analysis does flag a client module that imports lib/env.server", () => {
    const fake = path.join(root, "features/__fake_client__.tsx");
    const saved = new Map(imports);
    imports.set(fake, [envServer]);
    source.set(fake, '"use client";\nimport { serverEnv } from "@/lib/env.server";');
    files.push(fake);
    try {
      expect(files.filter(isClientModule).some((f) => (imports.get(f) ?? []).includes(envServer))).toBe(true);
      expect([...reachableFromClient().keys()]).toContain(envServer);
    } finally {
      files.pop();
      source.delete(fake);
      imports.delete(fake);
      for (const [k, v] of saved) imports.set(k, v);
    }
  });
});
