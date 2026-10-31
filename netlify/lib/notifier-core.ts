// LINOE B4.2 — payment alert e-mail sender (core logic).
//
// Self-contained on purpose: relative imports only, no "@/" aliases, no "server-only", no SDKs (PostgREST + Resend over fetch), no enums
// or parameter properties. It is bundled by Netlify for the scheduled function and is unit-tested with a fake fetch.
//
// Safety properties (each one is asserted by tests):
//   * ALERT_EMAIL_ENABLED must be exactly "true", otherwise nothing happens and the database is NOT contacted.
//   * Missing configuration => "misconfigured" with the NAMES of the missing variables (never values); nothing is sent.
//   * ALERT_EMAIL_DRY_RUN=true only calls the read-only preview function; nothing is claimed and nothing is sent.
//   * Recipients are resolved by the database from the active operator UUIDs; no address is ever hard-coded here.
//   * The e-mail text and the idempotency key come from the database (frozen before the first attempt); this code never builds them.
//   * Logs and results contain fixed codes only: never a secret, a response body or a recipient address.

export type NotifierEnv = Record<string, string | undefined>;

export type NotifierDeps = {
  env: NotifierEnv;
  fetchImpl: typeof fetch;
  nowMs?: () => number;
  log?: (line: string) => void;
};

export type NotifierResult =
  | { status: "disabled" }
  | { status: "misconfigured"; missing: string[] }
  | { status: "dry_run"; preview: Record<string, unknown> | null }
  | { status: "ok"; processed: number; sent: number; failed: number; last: string }
  | { status: "error"; code: string };

const RESEND_URL = "https://api.resend.com/emails";
const MAX_BATCHES_PER_RUN = 3;
const RUN_BUDGET_MS = 20_000; // Netlify scheduled functions stop at 30 s
const HTTP_TIMEOUT_MS = 8_000;
const HARD_DAILY_CAP = 20;

type Config = {
  supabaseUrl: string;
  serviceKey: string;
  resendKey: string;
  from: string;
  link: string | null;
  dailyLimit: number;
  dryRun: boolean;
};

const FROM_PATTERN = /^(?:[^<>\r\n@]{1,80}<[^<>\s@]{1,64}@[^<>\s@]{1,190}\.[^<>\s@]{2,}>|[^<>\s@]{1,64}@[^<>\s@]{1,190}\.[^<>\s@]{2,})$/;

export function readConfig(env: NotifierEnv): { ok: true; config: Config } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  const get = (name: string): string => {
    const v = (env[name] ?? "").trim();
    if (!v) missing.push(name);
    return v;
  };
  const supabaseUrl = get("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = get("SUPABASE_SECRET_KEY");
  const resendKey = get("RESEND_ALERT_API_KEY");
  const from = get("ALERT_EMAIL_FROM");
  const dryRun = (env.ALERT_EMAIL_DRY_RUN ?? "").trim() === "true";
  // dry run never needs the e-mail provider key
  const needsMail = !dryRun;
  const effectiveMissing = missing.filter((m) => needsMail || (m !== "RESEND_ALERT_API_KEY" && m !== "ALERT_EMAIL_FROM"));
  if (supabaseUrl && !/^https:\/\/[^\s/]+\.[^\s/]+\/?$/.test(supabaseUrl)) effectiveMissing.push("NEXT_PUBLIC_SUPABASE_URL(invalid)");
  if (needsMail && from && !FROM_PATTERN.test(from)) effectiveMissing.push("ALERT_EMAIL_FROM(invalid)");
  if (effectiveMissing.length > 0) return { ok: false, missing: effectiveMissing };

  const linkBase = (env.ALERT_EMAIL_LINK_BASE ?? "").trim().replace(/\/+$/, "");
  const link = /^https:\/\/[^\s<>"']{1,160}$/.test(linkBase) ? `${linkBase}/ops/payments` : null;
  const rawLimit = Number.parseInt((env.ALERT_EMAIL_DAILY_LIMIT ?? "").trim(), 10);
  const dailyLimit = Number.isFinite(rawLimit) ? Math.min(HARD_DAILY_CAP, Math.max(1, rawLimit)) : HARD_DAILY_CAP;
  return {
    ok: true,
    config: { supabaseUrl: supabaseUrl.replace(/\/+$/, ""), serviceKey, resendKey, from, link, dailyLimit, dryRun },
  };
}

type Http = { ok: boolean; status: number; json: unknown; failed?: "TIMEOUT" | "NETWORK" };

async function request(deps: NotifierDeps, url: string, init: { headers: Record<string, string>; body: string }): Promise<Http> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await deps.fetchImpl(url, { method: "POST", headers: init.headers, body: init.body, signal: ctrl.signal });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return { ok: false, status: 0, json: null, failed: aborted ? "TIMEOUT" : "NETWORK" };
  } finally {
    clearTimeout(timer);
  }
}

function rpc(deps: NotifierDeps, c: Config, fn: string, args: Record<string, unknown>): Promise<Http> {
  return request(deps, `${c.supabaseUrl}/rest/v1/rpc/${fn}`, {
    headers: { "Content-Type": "application/json", apikey: c.serviceKey, Authorization: `Bearer ${c.serviceKey}` },
    body: JSON.stringify(args),
  });
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

type Outcome = { kind: "sent"; messageId: string | null } | { kind: "fail"; code: string; status: number | null; rotate: boolean; permanent: boolean };

export function classifyResend(r: Http): Outcome {
  if (r.failed) return { kind: "fail", code: r.failed, status: null, rotate: false, permanent: false };
  if (r.ok) {
    const id = asObject(r.json)?.id;
    return { kind: "sent", messageId: typeof id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(id) ? id : null };
  }
  if (r.status === 409) {
    const name = asObject(r.json)?.name;
    if (name === "invalid_idempotent_request") {
      return { kind: "fail", code: "HTTP_409_INVALID_IDEMPOTENT", status: 409, rotate: true, permanent: false };
    }
    return { kind: "fail", code: "HTTP_409_CONCURRENT", status: 409, rotate: false, permanent: false };
  }
  if (r.status === 429) return { kind: "fail", code: "HTTP_429", status: 429, rotate: false, permanent: false };
  if (r.status >= 500) return { kind: "fail", code: "HTTP_5XX", status: r.status, rotate: false, permanent: false };
  if (r.status === 401 || r.status === 403) return { kind: "fail", code: `HTTP_${r.status}`, status: r.status, rotate: false, permanent: false };
  return { kind: "fail", code: `HTTP_${r.status}`, status: r.status, rotate: false, permanent: true };
}

export async function runNotifier(deps: NotifierDeps): Promise<NotifierResult> {
  const log = deps.log ?? (() => {});
  const now = deps.nowMs ?? (() => Date.now());
  if ((deps.env.ALERT_EMAIL_ENABLED ?? "").trim() !== "true") return { status: "disabled" };

  const cfg = readConfig(deps.env);
  if (!cfg.ok) {
    log(`notifier misconfigured: ${cfg.missing.join(",")}`);
    return { status: "misconfigured", missing: cfg.missing };
  }
  const c = cfg.config;

  if (c.dryRun) {
    const p = await rpc(deps, c, "fn_preview_payment_notifications", {});
    if (!p.ok) return { status: "error", code: p.failed ?? `PREVIEW_HTTP_${p.status}` };
    return { status: "dry_run", preview: asObject(p.json) };
  }

  const started = now();
  let processed = 0;
  let sent = 0;
  let failed = 0;
  let last = "NOTHING";

  for (let i = 0; i < MAX_BATCHES_PER_RUN; i += 1) {
    if (now() - started > RUN_BUDGET_MS) {
      last = "TIME_BUDGET";
      break;
    }
    const claim = await rpc(deps, c, "fn_claim_payment_notification_batch", {
      p_daily_limit: c.dailyLimit,
      p_critical_reserve: Math.min(5, c.dailyLimit),
      p_max_items: 20,
      p_link: c.link,
    });
    if (!claim.ok) return { status: "error", code: claim.failed ?? `CLAIM_HTTP_${claim.status}` };
    const job = asObject(claim.json);
    if (!job) return { status: "error", code: "CLAIM_BAD_RESPONSE" };
    if (job.result !== "CLAIMED") {
      last = typeof job.result === "string" && /^[A-Z_]{1,40}$/.test(job.result) ? job.result : "UNKNOWN";
      break;
    }
    const batchId = typeof job.batch_id === "string" ? job.batch_id : "";
    const attemptNo = typeof job.attempt_no === "number" ? job.attempt_no : 0;
    const key = typeof job.idempotency_key === "string" ? job.idempotency_key : "";
    const subject = typeof job.subject === "string" ? job.subject : "";
    const text = typeof job.text === "string" ? job.text : "";
    const userIds = Array.isArray(job.recipient_user_ids) ? job.recipient_user_ids.filter((x) => typeof x === "string") : [];
    if (!batchId || !attemptNo || key.length < 1 || key.length > 256 || !subject || !text || userIds.length === 0) {
      return { status: "error", code: "CLAIM_BAD_PAYLOAD" };
    }
    processed += 1;

    const fail = async (code: string, status: number | null, rotate: boolean, permanent: boolean) => {
      failed += 1;
      last = code;
      await rpc(deps, c, "fn_fail_payment_notification_batch", {
        p_batch_id: batchId,
        p_attempt_no: attemptNo,
        p_error_code: code,
        p_http_status: status,
        p_rotate_key: rotate,
        p_permanent: permanent,
      });
      log(`notifier batch failed: ${code}`);
    };

    // resolve addresses at send time: only operators that are STILL active and confirmed
    const em = await rpc(deps, c, "fn_payment_notification_recipient_emails", { p_user_ids: userIds });
    const to = Array.isArray(em.json) ? em.json.filter((x): x is string => typeof x === "string" && x.includes("@")) : [];
    if (!em.ok || to.length === 0) {
      await fail("NO_RECIPIENT_EMAIL", null, false, false);
      continue;
    }

    const out = classifyResend(
      await request(deps, RESEND_URL, {
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.resendKey}`, "Idempotency-Key": key },
        body: JSON.stringify({ from: c.from, to, subject, text }),
      }),
    );
    if (out.kind === "fail") {
      await fail(out.code, out.status, out.rotate, out.permanent);
      continue;
    }
    sent += 1;
    last = "SENT";
    const done = await rpc(deps, c, "fn_complete_payment_notification_batch", { p_batch_id: batchId, p_provider_message_id: out.messageId });
    // if completing fails the lease runs out and the retry re-sends with the SAME key: the provider returns the original answer, no second e-mail
    if (!done.ok) log("notifier complete failed: COMPLETE_FAILED");
  }
  return { status: "ok", processed, sent, failed, last };
}
