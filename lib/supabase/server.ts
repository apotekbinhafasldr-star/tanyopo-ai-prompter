import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * Server Component / Server Action / Route Handler Supabase client.
 * Reads and writes the session via Next.js cookies. Still bound by RLS —
 * this is the user's own session, not an elevated key.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    publicEnv.supabaseUrl,
    publicEnv.supabasePublishableKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component that can't set cookies.
            // The proxy (see proxy.ts) refreshes the session on every
            // request, so this is safe to ignore.
          }
        },
      },
    },
  );
}
