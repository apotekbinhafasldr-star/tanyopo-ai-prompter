// LINOE C2 — Netlify Scheduled Function: re-checks PENDING payments older than 10 minutes. Thin wrapper; the logic lives
// in ../lib/pending-sweep-core.ts and in the app's guarded endpoint. Disabled unless PAYMENT_SWEEPER_ENABLED is exactly
// "true" in the Netlify environment. Scheduled functions only run on published production deploys.
import { runPendingSweep, summarizeSweep } from "../lib/pending-sweep-core";

export default async function handler(): Promise<Response> {
  const result = await runPendingSweep({ env: process.env, fetchImpl: fetch });
  console.log(`[payment-pending-sweep] ${summarizeSweep(result)}`);
  return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
}

export const config = { schedule: "*/10 * * * *" };
