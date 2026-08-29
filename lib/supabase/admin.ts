import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * Service-role Supabase client. Bypasses RLS entirely.
 *
 * NEVER import this from a Client Component or expose its result to the
 * browser. Use only in trusted server-side code that has already verified
 * the caller's tenant/role (webhooks, signed integration endpoints, admin
 * background jobs).
 *
 * Returns `null` when SUPABASE_SECRET_KEY is not configured — callers must
 * handle this and surface a NOT_CONFIGURED state rather than crash.
 */
export function createAdminClient() {
  if (!serverEnv.supabaseSecretKey) {
    return null;
  }

  return createSupabaseClient<Database>(
    publicEnv.supabaseUrl,
    serverEnv.supabaseSecretKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
