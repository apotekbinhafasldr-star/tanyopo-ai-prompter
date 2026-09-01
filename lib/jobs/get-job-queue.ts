import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { JobQueueProvider } from "@/lib/jobs/job-queue";
import { SupabaseJobQueue } from "@/lib/jobs/providers/supabase-job-queue";

/**
 * Resolves the job queue provider — same "one place, so nothing else
 * picks a provider itself" pattern as lib/connectors/get-connector.ts
 * and lib/billing/get-payment-provider.ts. Unlike those, this one takes
 * the (already-resolved, possibly-null) service-role client rather than
 * reading env directly, since every current/future provider needs a way
 * to reach the database for tenant/audit context regardless of where
 * jobs actually execute. Returns null when the service-role key isn't
 * configured (same NOT_CONFIGURED contract as createAdminClient()) —
 * callers must handle that rather than crash.
 */
export function getJobQueue(admin: SupabaseClient<Database> | null): JobQueueProvider | null {
  if (!admin) return null;
  return new SupabaseJobQueue(admin);
}
