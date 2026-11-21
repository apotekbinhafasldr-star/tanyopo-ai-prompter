import { PostHog } from "posthog-node";
import type { TelemetryTransport } from "./send";

/**
 * The only file that imports `posthog-node`. Loaded lazily (dynamic import in
 * index.ts) and only when telemetry is enabled, so with the integration OFF the
 * SDK is never initialised and no network request is possible.
 *
 * Serverless settings per PostHog's Node docs: flushAt 1 + flushInterval 0, no
 * SDK-level retry (retries would hold the user's request), short request
 * timeout, GeoIP disabled. No autocapture, no exception autocapture, no feature
 * flags, no identify/alias/groupIdentify calls (so no person profiles).
 */
export function createPostHogTransport(apiKey: string, host: string): TelemetryTransport {
  const client = new PostHog(apiKey, {
    host,
    flushAt: 1,
    flushInterval: 0,
    fetchRetryCount: 0,
    requestTimeout: 1500,
    disableGeoip: true,
  });

  return {
    async send(message) {
      await client.captureImmediate({
        distinctId: message.distinctId,
        event: message.event,
        properties: message.properties,
        uuid: message.uuid,
        disableGeoip: true,
      });
    },
  };
}
