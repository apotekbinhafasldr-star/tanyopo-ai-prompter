// LINOE B4.2 — Netlify Scheduled Function: payment alert e-mails. Thin wrapper; the logic lives in ../lib/notifier-core.ts.
// Disabled unless ALERT_EMAIL_ENABLED is exactly "true" in the Netlify environment (see docs/BILLING_B4_2_EMAIL_NOTIFICATIONS.md).
// Scheduled functions only run on published production deploys and cannot be invoked by URL.
import { runNotifier } from "../lib/notifier-core";

export default async function handler(): Promise<Response> {
  const result = await runNotifier({
    env: process.env,
    fetchImpl: fetch,
    log: (line) => console.log(`[payment-alert-notify] ${line}`),
  });
  // fixed, secret-free summary only
  return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
}

export const config = { schedule: "*/5 * * * *" };
