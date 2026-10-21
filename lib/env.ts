/**
 * Browser-safe environment access: `publicEnv` (NEXT_PUBLIC_* only) and pure helpers.
 *
 * This module is imported by the browser bundle (lib/supabase/client.ts), so it must never
 * hold, read or mention a server secret. Server-side configuration lives in lib/env.server.ts,
 * which starts with `import "server-only"`: importing it from a Client Component fails the
 * build instead of silently shipping (or silently losing) a server variable.
 */

/**
 * B4 hotfix root cause: this used to be `readPublic(name: string)` doing a
 * dynamic `process.env[name]` lookup. Next.js only inlines `NEXT_PUBLIC_*`
 * variables into a CLIENT bundle when the source contains a *static*
 * `process.env.NEXT_PUBLIC_X` member expression it can find at build
 * time — a computed/dynamic lookup can't be statically analyzed, so it
 * was never inlined for the browser. That was invisible for years because
 * `publicEnv` had only ever been read from Server Components/Server
 * Actions (real Node.js `process.env`, where dynamic access works fine).
 * lib/supabase/client.ts (browser Supabase client) was the first thing in
 * this codebase to pull `publicEnv` into an actual Client Component
 * bundle — at which point `process.env[name]` evaluated to `undefined` in
 * every visitor's browser, throwing this exact "Missing required public
 * environment variable" error the moment that bundle's module graph
 * evaluated (i.e. as soon as the page hydrated, before any click),
 * exactly matching the second-generation "This page couldn't load" crash
 * — reproduced locally with the identical browser stack trace and error
 * page. `readPublic` now takes the already-read value as a parameter, so
 * every call site above still uses a literal `process.env.NEXT_PUBLIC_X`
 * expression Next.js's compiler can actually see and inline for both
 * server and client bundles.
 */
function readPublic(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required public environment variable: ${name}. Check .env.example and your .env.local.`,
    );
  }
  return value;
}

export const publicEnv = {
  supabaseUrl: readPublic("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabasePublishableKey: readPublic(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  ),
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
};

/** True when every credential a connector needs to operate is present. */
export function isConnectorConfigured(
  credentials: Record<string, string | undefined>,
): boolean {
  return Object.values(credentials).every((v) => !!v && v.length > 0);
}
