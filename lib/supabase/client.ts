"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * Browser-side Supabase client. Uses the publishable (anon) key only —
 * safe to expose to the client. RLS on every `prompter_*` table is what
 * actually enforces tenant isolation, not this client.
 */
export function createClient() {
  return createBrowserClient<Database>(
    publicEnv.supabaseUrl,
    publicEnv.supabasePublishableKey,
  );
}
