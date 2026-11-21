import "server-only";

import { readTelemetryConfig } from "./config";
import { durationBucket, type AiJobFinishedProps, type AppErrorProps } from "./events";
import { tenantHash } from "./identity";
import { createTelemetry, type Telemetry, type TelemetryTransport } from "./send";

/**
 * Central, fail-open PostHog telemetry (Phase 1: server only, posthog-node).
 * Public helpers never throw and never reject; with the integration OFF they
 * return immediately and make no network request.
 */

let cached: Telemetry | null = null;
let loaderOverride: ((apiKey: string, host: string) => Promise<TelemetryTransport>) | null = null;

function getTelemetry(): Telemetry {
  if (cached) return cached;
  const config = readTelemetryConfig();
  let transport: Promise<TelemetryTransport> | null = null;
  cached = createTelemetry({
    config,
    getTransport: () => {
      if (!config.enabled) return Promise.reject(new Error("telemetry_disabled"));
      if (!transport) {
        const attempt: Promise<TelemetryTransport> = loaderOverride
          ? loaderOverride(config.apiKey, config.host)
          : import("./transport-posthog").then((m) => m.createPostHogTransport(config.apiKey, config.host));
        // Do not cache a failed load: a transient failure must not disable telemetry for the whole instance lifetime.
        transport = attempt.catch((err) => {
          transport = null;
          throw err;
        });
      }
      return transport;
    },
  });
  return cached;
}

/** True only when the integration is fully configured and ON. No side effects. */
export function isTelemetryEnabled(): boolean {
  try {
    return readTelemetryConfig().enabled;
  } catch {
    return false;
  }
}

/** Test hook: drop the cached instance so the next call re-reads the environment. */
export function resetTelemetryForTests(loader?: (apiKey: string, host: string) => Promise<TelemetryTransport>): void {
  cached = null;
  loaderOverride = loader ?? null;
}

function baseProps(
  tenantId: string | null | undefined,
): { common: Pick<AiJobFinishedProps, "env" | "app_version" | "tenant_hash"> } | null {
  const config = readTelemetryConfig();
  if (!config.enabled) return null;
  return {
    common: { env: config.env, app_version: config.appVersion, tenant_hash: tenantHash(tenantId, config.salt) },
  };
}

export interface AiJobFinishedInput {
  tenantId: string;
  jobId: string;
  jobType: AiJobFinishedProps["job_type"];
  status: AiJobFinishedProps["status"];
  errorCategory?: AiJobFinishedProps["error_category"];
  model?: string | null;
  durationMs: number;
}

export async function emitAiJobFinished(input: AiJobFinishedInput): Promise<void> {
  try {
    const base = baseProps(input.tenantId);
    if (!base) return;
    const props: AiJobFinishedProps = {
      ...base.common,
      job_type: input.jobType,
      status: input.status,
      ...(input.errorCategory ? { error_category: input.errorCategory } : {}),
      model: input.model && input.model.length > 0 ? input.model : "unknown",
      duration_bucket: durationBucket(input.durationMs),
    };
    await getTelemetry().emit("ai_job_finished", props, base.common.tenant_hash, input.jobId);
  } catch {
    // fail-open
  }
}

export interface AppErrorInput {
  tenantId: string | null;
  /** Unique per occurrence (e.g. the job id) for at-most-once delivery. */
  occurrenceId: string;
  surface: AppErrorProps["surface"];
  errorName: string;
  errorCategory: AppErrorProps["error_category"];
  httpStatus?: number;
  routeGroup: AppErrorProps["route_group"];
}

/** Only an allowlisted class name is sent, never the error message or stack. */
const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;

export async function emitAppError(input: AppErrorInput): Promise<void> {
  try {
    const base = baseProps(input.tenantId);
    if (!base) return;
    const props: AppErrorProps = {
      ...base.common,
      surface: input.surface,
      error_name: SAFE_NAME.test(input.errorName) ? input.errorName : "Error",
      error_category: input.errorCategory,
      ...(input.httpStatus !== undefined ? { http_status: input.httpStatus } : {}),
      route_group: input.routeGroup,
    };
    await getTelemetry().emit("app_error", props, base.common.tenant_hash, input.occurrenceId);
  } catch {
    // fail-open
  }
}
