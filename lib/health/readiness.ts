import { createClient } from "@supabase/supabase-js";

/**
 * Readiness check for uptime monitors (app/api/ready/route.ts).
 *
 * Answers one question: "can this app reach its database right now?". It is
 * read-only (a single `select ... limit 1` through the public publishable
 * key, subject to RLS — no service-role key, no write) and bounded by a
 * timeout. The result is only ever "ok" or "degraded": the reason is never
 * returned to the caller (no error text, hostnames, project ref, versions).
 */
export type ReadinessStatus = "ok" | "degraded";

export const READINESS_TIMEOUT_MS = 3000;

// Any table works: we only need PostgREST to answer from Postgres. The table is
// reference data with RLS on, so an anonymous caller receives zero rows (or a
// permission error, handled below) — never data.
const PROBE_TABLE = "prompter_plan_entitlements";

type ProbeResult = { error: { code?: string } | null };

export type ReadinessProbe = (signal: AbortSignal) => PromiseLike<ProbeResult>;

function defaultProbe(signal: AbortSignal): PromiseLike<ProbeResult> {
  // Static `process.env.X` expressions so Next can inline them; checked here
  // (not at import time) so a missing variable degrades instead of crashing.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return Promise.resolve({ error: { code: "NOT_CONFIGURED" } });
  }
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client.from(PROBE_TABLE).select("plan").limit(1).abortSignal(signal);
}

export async function checkReadiness(
  probe: ReadinessProbe = defaultProbe,
  timeoutMs: number = READINESS_TIMEOUT_MS,
): Promise<ReadinessStatus> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve("timeout");
    }, timeoutMs);
  });

  try {
    const outcome = await Promise.race([Promise.resolve(probe(controller.signal)), timeout]);
    if (outcome === "timeout") {
      return "degraded";
    }
    // 42501 = "permission denied" returned BY Postgres: the database answered
    // (anonymous role is simply not allowed to read this table), so it is up.
    // Every other error (network, 5xx, bad key, not configured) is degraded.
    if (!outcome.error || outcome.error.code === "42501") {
      return "ok";
    }
    return "degraded";
  } catch {
    return "degraded";
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
