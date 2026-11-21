import { createHash } from "node:crypto";
import type { TelemetryConfig } from "./config";
import { validateEvent } from "./events";

/** What the SDK adapter must accept. Kept tiny so tests can use a mock. */
export interface TelemetryTransport {
  send(message: {
    distinctId: string;
    event: string;
    properties: Record<string, string | number | boolean>;
    uuid: string;
    disableGeoip: true;
  }): Promise<void>;
}

export type EmitResult = "sent" | "skipped" | "rejected" | "failed";

export interface TelemetryOptions {
  config: TelemetryConfig;
  /** Required only when config.enabled; loaded lazily so OFF never loads the SDK. */
  getTransport: () => Promise<TelemetryTransport>;
  now?: () => number;
  /** Total time budget for one send, ms. Default 1000. */
  timeoutMs?: number;
  /** Consecutive failures before the breaker opens. Default 3. */
  breakerThreshold?: number;
  /** How long the breaker stays open, ms. Default 5 minutes. */
  breakerCooldownMs?: number;
  /** Safe log sink: receives event name + category only, never payload. */
  log?: (line: string) => void;
}

const UUID_NAMESPACE = "6f1c9a52-3d0e-4a5b-9c7e-4e1d8b2a7f30"; // fixed, LINOE telemetry only
const MAX_DEDUPE_KEYS = 1000;

/** Deterministic UUID v5 (SHA-1) so a repeated emit has the same event id. */
export function uuidV5(name: string, namespace: string = UUID_NAMESPACE): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(ns).update(name, "utf8").digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface Telemetry {
  /**
   * Validates and sends one allowlisted event. NEVER throws and never rejects.
   * `dedupeKey` (e.g. the job id) makes the event at-most-once per process and
   * gives it a deterministic id.
   */
  emit(event: string, properties: unknown, distinctId: string, dedupeKey: string): Promise<EmitResult>;
}

export function createTelemetry(opts: TelemetryOptions): Telemetry {
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? 1000;
  const threshold = opts.breakerThreshold ?? 3;
  const cooldown = opts.breakerCooldownMs ?? 5 * 60 * 1000;
  const log = opts.log ?? ((line: string) => console.warn(line));

  const seen = new Set<string>();
  let failures = 0;
  let openUntil = 0;

  function remember(key: string): void {
    if (seen.size >= MAX_DEDUPE_KEYS) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    seen.add(key);
  }

  return {
    async emit(event, properties, distinctId, dedupeKey): Promise<EmitResult> {
      try {
        if (!opts.config.enabled) return "skipped";

        const validated = validateEvent(event, properties);
        if (!validated.ok) {
          // Issue codes and paths only: never values.
          log(
            `[telemetry] rejected event=${String(event).slice(0, 40)} issues=${validated.issues
              .slice(0, 5)
              .map((i) => `${i.code}@${i.path}`)
              .join(",")}`,
          );
          return "rejected";
        }

        if (now() < openUntil) return "skipped";

        const key = `${validated.value.event}:${dedupeKey}`;
        if (seen.has(key)) return "skipped";
        remember(key);

        // ONE time budget covers lazy SDK load (getTransport) AND the send, so
        // nothing here can hold the caller (an AI job) beyond timeoutMs.
        const work = (async () => {
          const transport = await opts.getTransport();
          await transport.send({
            distinctId,
            event: validated.value.event,
            properties: { ...validated.value.properties, $process_person_profile: false },
            uuid: uuidV5(key),
            disableGeoip: true,
          });
        })();
        work.catch(() => {}); // a late rejection after the timeout must not become unhandled
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("telemetry_timeout")), timeoutMs);
        });
        try {
          await Promise.race([work, timeout]);
        } finally {
          if (timer) clearTimeout(timer);
        }

        failures = 0;
        return "sent";
      } catch {
        failures += 1;
        if (failures >= threshold) {
          openUntil = now() + cooldown;
          failures = 0;
        }
        // No error message or stack: it could echo payload or credentials.
        log(`[telemetry] send failed event=${String(event).slice(0, 40)}`);
        return "failed";
      }
    },
  };
}
