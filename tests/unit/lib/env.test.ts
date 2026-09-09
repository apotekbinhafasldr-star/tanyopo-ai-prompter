import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * B4 hotfix regression test. Root cause of the "This page couldn't load"
 * crash on /products/[id]: publicEnv used to read NEXT_PUBLIC_* variables
 * via a dynamic `process.env[name]` lookup. Next.js can only inline
 * `NEXT_PUBLIC_*` variables into a browser bundle when it can statically
 * see a literal `process.env.NEXT_PUBLIC_X` member expression at build
 * time — a computed/dynamic key defeats that analysis, so the value was
 * never inlined for the client. That was invisible for years because
 * publicEnv had only ever been read from Server Components/Actions (real
 * Node.js process.env) — lib/supabase/client.ts (Batch B4) was the first
 * thing to pull it into an actual browser bundle, at which point the
 * dynamic lookup silently resolved to undefined in every visitor's
 * browser and publicEnv threw "Missing required public environment
 * variable" the moment that module evaluated — i.e. on page load, before
 * any click. Reproduced locally against a real production build/server
 * with the identical browser stack trace and "This page couldn't load"
 * error page.
 *
 * A normal runtime assertion can't tell whether Next.js's bundler would
 * actually inline a given expression (that's a build-time, static-
 * analysis property, and this test suite doesn't run Next's own
 * compiler) — so this test asserts the property directly against the
 * module's own source text: every NEXT_PUBLIC_* read must be a literal
 * `process.env.NEXT_PUBLIC_X` expression, never a computed lookup.
 */
describe("lib/env.ts publicEnv — client-bundle inlining safety", () => {
  const source = readFileSync(resolve(__dirname, "../../../lib/env.ts"), "utf-8");

  it("reads every NEXT_PUBLIC_* variable via a literal process.env.NEXT_PUBLIC_X expression", () => {
    const publicVarNames = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
    for (const name of publicVarNames) {
      expect(source).toContain(`process.env.${name}`);
    }
  });

  it("never reads a NEXT_PUBLIC_* variable through a computed/dynamic process.env[...] lookup", () => {
    // Scoped to readPublic()/publicEnv specifically — readOptional() (used
    // only for server-only secrets in serverEnv, never client-bundled)
    // legitimately still uses a dynamic process.env[name] lookup; that's
    // fine there and shouldn't fail this check.
    const readPublicBody = source.slice(source.indexOf("function readPublic"), source.indexOf("function readOptional"));
    const publicEnvBlock = source.slice(source.indexOf("export const publicEnv"), source.indexOf("export const serverEnv"));

    expect(readPublicBody).not.toMatch(/process\.env\[/);
    expect(publicEnvBlock).not.toMatch(/process\.env\[/);
  });
});

describe("publicEnv", () => {
  it("exposes whatever NEXT_PUBLIC_SUPABASE_URL/PUBLISHABLE_KEY are actually set in the environment", async () => {
    // Doesn't assume a specific value (this suite runs in environments
    // where these may or may not be set) — only that reading them via a
    // literal `process.env.NEXT_PUBLIC_X` expression round-trips
    // correctly, which is the behavior the dynamic-lookup bug broke for
    // the client bundle specifically.
    const { publicEnv } = await import("@/lib/env");
    expect(publicEnv.supabaseUrl).toBe(process.env.NEXT_PUBLIC_SUPABASE_URL);
    expect(publicEnv.supabasePublishableKey).toBe(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  });
});
