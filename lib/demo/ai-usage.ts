import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Hard usage cap + rate limit + abuse protection for the demo's "real AI"
 * path (Founder requirement #3 — HYBRID AI: "real AI wajib mempunyai hard
 * usage cap; rate limiting; abuse protection; cost ceiling/fail-safe.
 * Demo tidak boleh menghasilkan API cost tanpa batas.").
 *
 * Two independent layers, deliberately redundant:
 *  1. An in-memory burst limiter (lib/rate-limit.ts) — cheap, instant,
 *     but process-local (documented gap: not shared across serverless
 *     instances).
 *  2. A DB-backed hard cap in `prompter_demo_ai_usage`, checked via the
 *     service-role admin client — authoritative across every instance,
 *     and the layer that actually enforces the ceiling.
 *
 * Fails CLOSED on every error path: no admin client configured, no row,
 * or any DB error all resolve to "not allowed" — a demo visitor can never
 * talk the cap into unlimited AI usage by triggering a failure mode. The
 * pre-generated dataset (lib/demo/dataset.ts) is always available as the
 * safe fallback, so failing closed here never breaks the demo experience,
 * it just silently serves canned content instead of a live model call.
 */

/** Hard ceiling: real AI calls allowed per demo session, ever. */
export const DEMO_AI_HARD_CAP = 5;

/** Burst guard: real AI calls allowed per session within a short window. */
const BURST_LIMIT = 2;
const BURST_WINDOW_MS = 60 * 1000;

export type DemoAiUsageCheck =
  | { allowed: true }
  | { allowed: false; reason: "BURST_LIMIT" | "HARD_CAP_REACHED" | "NOT_CONFIGURED" | "DB_ERROR" };

/**
 * Atomically checks and, if allowed, consumes one unit of a demo
 * session's real-AI allowance. Call this immediately before a live AI
 * provider call is made — never after — so a failure here always
 * prevents the call it guards.
 */
export async function checkAndConsumeDemoAiUsage(sessionId: string): Promise<DemoAiUsageCheck> {
  const burst = checkRateLimit(`demo-ai:${sessionId}`, BURST_LIMIT, BURST_WINDOW_MS);
  if (!burst.allowed) {
    return { allowed: false, reason: "BURST_LIMIT" };
  }

  const admin = createAdminClient();
  if (!admin) {
    return { allowed: false, reason: "NOT_CONFIGURED" };
  }

  // fn_consume_demo_ai_usage() is SECURITY DEFINER, atomically increments
  // (or inserts) the session's counter and returns whether the hard cap
  // was already reached — a single round trip, avoiding a
  // check-then-increment race between concurrent requests from the same
  // demo session (same shape as Batch B9's per-tenant advisory lock, just
  // scoped to a single UPDATE ... RETURNING instead — this table has no
  // concurrent-tenant contention to protect against, only itself).
  const { data, error } = await admin.rpc("fn_consume_demo_ai_usage", {
    p_session_id: sessionId,
    p_hard_cap: DEMO_AI_HARD_CAP,
  });

  if (error) {
    return { allowed: false, reason: "DB_ERROR" };
  }

  const allowed = Array.isArray(data) ? data[0]?.allowed : (data as { allowed?: boolean } | null)?.allowed;
  if (!allowed) {
    return { allowed: false, reason: "HARD_CAP_REACHED" };
  }

  return { allowed: true };
}
