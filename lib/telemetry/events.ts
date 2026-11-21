import { z } from "zod";

/**
 * Event allowlist. `z.strictObject` REJECTS the whole event when it carries
 * any unknown key (it does not strip it), so a stray property can never be
 * "cleaned and sent": the event is dropped. Unknown event names are rejected
 * by `validateEvent`.
 *
 * Forbidden everywhere: email, name, phone, tokens/keys, prompts, AI output,
 * campaign text, customer data, error messages, raw stacks, IPs, URLs.
 */

export const JOB_TYPES = [
  "MARKETING_BLUEPRINT",
  "CAMPAIGN_PROPOSAL",
  "CONTENT_GENERATION",
  "SEO_RECOMMENDATIONS",
  "ANALYTICS_INSIGHT",
  "OPTIMIZATION_RECOMMENDATION",
] as const;

export const ERROR_CATEGORIES = [
  "AUTH",
  "RATE_LIMIT",
  "CONNECTION",
  "API",
  "REFUSAL",
  "INVALID_OUTPUT",
  "CONFIG",
  "UNKNOWN",
] as const;

export const ROUTE_GROUPS = ["ai_jobs"] as const;
export const SURFACES = ["ai_job"] as const;
export const DURATION_BUCKETS = ["lt_1s", "1_5s", "5_30s", "gt_30s"] as const;

const common = {
  env: z.enum(["production", "preview"]),
  app_version: z.string().regex(/^[A-Za-z0-9._-]{1,40}$/),
  tenant_hash: z.string().regex(/^(?:[0-9a-f]{32}|system)$/),
};

export const AiJobFinishedSchema = z.strictObject({
  ...common,
  job_type: z.enum(JOB_TYPES),
  status: z.enum(["completed", "failed"]),
  error_category: z.enum(ERROR_CATEGORIES).optional(),
  model: z.string().regex(/^[A-Za-z0-9._:/-]{1,64}$/),
  duration_bucket: z.enum(DURATION_BUCKETS),
});

export const AppErrorSchema = z.strictObject({
  ...common,
  surface: z.enum(SURFACES),
  error_name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,59}$/),
  error_category: z.enum(ERROR_CATEGORIES),
  http_status: z.number().int().min(100).max(599).optional(),
  route_group: z.enum(ROUTE_GROUPS),
});

export const EVENT_SCHEMAS = {
  ai_job_finished: AiJobFinishedSchema,
  app_error: AppErrorSchema,
} as const;

export type TelemetryEventName = keyof typeof EVENT_SCHEMAS;
export type AiJobFinishedProps = z.infer<typeof AiJobFinishedSchema>;
export type AppErrorProps = z.infer<typeof AppErrorSchema>;

/** Allowlisted JSON-safe properties, as validated. */
export type ValidatedEvent = { event: TelemetryEventName; properties: Record<string, string | number> };

export type ValidationFailure = { ok: false; issues: Array<{ code: string; path: string }> };
export type ValidationSuccess = { ok: true; value: ValidatedEvent };

/**
 * Validates one event. On failure returns ONLY Zod issue codes and property
 * paths, never the offending values.
 */
export function validateEvent(event: string, properties: unknown): ValidationSuccess | ValidationFailure {
  if (!Object.prototype.hasOwnProperty.call(EVENT_SCHEMAS, event)) {
    return { ok: false, issues: [{ code: "unknown_event", path: "" }] };
  }
  const schema = EVENT_SCHEMAS[event as TelemetryEventName];
  const parsed = schema.safeParse(properties);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({ code: String(i.code), path: i.path.join(".") })),
    };
  }
  return {
    ok: true,
    value: { event: event as TelemetryEventName, properties: parsed.data as Record<string, string | number> },
  };
}

/** Duration bucket so no raw timing is sent. */
export function durationBucket(ms: number): (typeof DURATION_BUCKETS)[number] {
  if (!Number.isFinite(ms) || ms < 1000) return "lt_1s";
  if (ms < 5000) return "1_5s";
  if (ms < 30000) return "5_30s";
  return "gt_30s";
}
