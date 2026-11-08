// LINOE C2 — scheduled sweeper trigger (core logic).
//
// Self-contained on purpose (same reasons as notifier-core.ts): relative imports only, fetch only, no "server-only".
// It does NOT settle anything itself. It POSTs to the app's own guarded endpoint, which runs the existing
// verifyAndSettle() for PENDING transactions older than 10 minutes.
//
//   * PAYMENT_SWEEPER_ENABLED must be exactly "true", otherwise nothing happens and the network is NOT contacted.
//   * Needs PAYMENT_SWEEPER_SECRET and an https base URL (PAYMENT_SWEEPER_BASE_URL, else Netlify's URL); otherwise
//     "misconfigured" with the NAMES of what is missing (never values).
//   * Logs and results contain fixed codes and numbers only: never the secret or a response body.

export type SweepEnv = Record<string, string | undefined>;

export type SweepTriggerResult =
  | { status: "disabled" }
  | { status: "misconfigured"; missing: string[] }
  | { status: "ok"; examined: number; applied: number; closed: number }
  | { status: "error"; code: string };

const ENDPOINT_PATH = "/api/internal/payments/sweep";
const HTTP_TIMEOUT_MS = 25_000; // Netlify scheduled functions stop at 30 s

export async function runPendingSweep(deps: { env: SweepEnv; fetchImpl: typeof fetch }): Promise<SweepTriggerResult> {
  const { env, fetchImpl } = deps;
  if ((env.PAYMENT_SWEEPER_ENABLED ?? "").trim() !== "true") return { status: "disabled" };

  const secret = (env.PAYMENT_SWEEPER_SECRET ?? "").trim();
  const base = (env.PAYMENT_SWEEPER_BASE_URL ?? env.URL ?? "").trim().replace(/\/+$/, "");
  const missing: string[] = [];
  if (!secret) missing.push("PAYMENT_SWEEPER_SECRET");
  if (!base) missing.push("PAYMENT_SWEEPER_BASE_URL");
  else if (!/^https:\/\/[^\s/]+\.[^\s/]+$/.test(base)) missing.push("PAYMENT_SWEEPER_BASE_URL(invalid)");
  if (missing.length > 0) return { status: "misconfigured", missing };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${base}${ENDPOINT_PATH}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" },
      redirect: "manual", // never follow a redirect (e.g. to /login) with the bearer token attached
      signal: ctrl.signal,
    });
    if (!res.ok) return { status: "error", code: `HTTP_${res.status}` };
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    const data = (json as { data?: Record<string, unknown> } | null)?.data ?? {};
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    return { status: "ok", examined: num(data.examined), applied: num(data.applied), closed: num(data.closed) };
  } catch (e) {
    return { status: "error", code: e instanceof Error && e.name === "AbortError" ? "TIMEOUT" : "NETWORK" };
  } finally {
    clearTimeout(timer);
  }
}

export function summarizeSweep(r: SweepTriggerResult): string {
  switch (r.status) {
    case "disabled":
      return "status=disabled";
    case "misconfigured":
      return `status=misconfigured missing=${r.missing.join(",")}`;
    case "ok":
      return `status=ok examined=${r.examined} applied=${r.applied} closed=${r.closed}`;
    default:
      return `status=error code=${r.code}`;
  }
}
