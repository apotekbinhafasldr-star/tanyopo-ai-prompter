// @vitest-environment node
import { describe, expect, it } from "vitest";
import { classifyResend, readConfig, runNotifier, summarize } from "../../../netlify/lib/notifier-core";

const SECRET = "sb_secret_TOPSECRET_123";
const RESEND = "re_TOPSECRET_456";
const baseEnv = {
  ALERT_EMAIL_ENABLED: "true",
  ALERT_EMAIL_DRY_RUN: "false", // real sending needs this explicit opt-out of the dry-run default
  NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SECRET_KEY: SECRET,
  RESEND_ALERT_API_KEY: RESEND,
  ALERT_EMAIL_FROM: "LINOE Alerts <alerts@example.test>",
  ALERT_EMAIL_LINK_BASE: "https://app.example.test/",
};

type Call = { url: string; headers: Record<string, string>; body: unknown };
function fake(handlers: Record<string, (c: Call) => { status?: number; json?: unknown } | "throw" | "abort">) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    const call: Call = { url, headers: init.headers, body: JSON.parse(init.body) };
    calls.push(call);
    const key = url.includes("api.resend.com") ? "resend" : url.split("/rpc/")[1];
    const h = handlers[key];
    if (!h) throw new Error(`unexpected call ${key}`);
    const r = h(call);
    if (r === "throw") throw new Error(`network down ${SECRET}`);
    if (r === "abort") {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    }
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => r.json ?? null } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const job = {
  result: "CLAIMED", retry: false, batch_id: "b-1", idempotency_key: "b-1-1", subject: "[LINOE] 1 alarm pembayaran", text: "isi", recipient_user_ids: ["u-1"], attempt_no: 1,
  from: "LINOE Alerts <alerts@example.test>", to: ["op@example.test"],
};
type Handlers = Parameters<typeof fake>[0];
const happy = (over: Handlers = {}) => {
  let claims = 0;
  return fake({
    fn_claim_payment_notification_batch: () => (++claims === 1 ? { json: job } : { json: { result: "NOTHING" } }),
    resend: () => ({ json: { id: "msg_1" } }),
    fn_complete_payment_notification_batch: () => ({ json: "SENT" }),
    fn_fail_payment_notification_batch: () => ({ json: "RETRY" }),
    fn_preview_payment_notifications: () => ({ json: { pending: 2 } }),
    ...over,
  });
};

describe("B4.2 notifier core", () => {
  it("is disabled by default and by anything but the exact string 'true' — and never touches the network", async () => {
    for (const v of [undefined, "", "false", "TRUE", "1", "yes", " false "]) {
      const f = fake({});
      const r = await runNotifier({ env: { ...baseEnv, ALERT_EMAIL_ENABLED: v }, fetchImpl: f.impl });
      expect(r).toEqual({ status: "disabled" });
      expect(f.calls).toHaveLength(0);
    }
  });

  it("reports missing configuration by NAME only and sends nothing", async () => {
    const f = fake({});
    const r = await runNotifier({ env: { ALERT_EMAIL_ENABLED: "true", ALERT_EMAIL_DRY_RUN: "false" }, fetchImpl: f.impl });
    expect(r.status).toBe("misconfigured");
    expect(JSON.stringify(r)).toContain("RESEND_ALERT_API_KEY");
    expect(JSON.stringify(r)).toContain("ALERT_EMAIL_FROM");
    // in the default (dry-run) mode only the database settings are required
    const d = await runNotifier({ env: { ALERT_EMAIL_ENABLED: "true" }, fetchImpl: f.impl });
    expect(JSON.stringify(d)).not.toContain("RESEND_ALERT_API_KEY");
    expect(f.calls).toHaveLength(0);
    expect(readConfig({ ...baseEnv, ALERT_EMAIL_FROM: "not an address" }).ok).toBe(false);
    expect(readConfig({ ...baseEnv, NEXT_PUBLIC_SUPABASE_URL: "http://insecure.test" }).ok).toBe(false);
  });

  it("dry run is the DEFAULT: only the exact string 'false' ever sends; every other value stays read-only (fail-safe)", async () => {
    for (const v of [undefined, "", "true", "TRUE", "True", "1", "0", "no", "FALSE", "False", " fals ", "false;", "off"]) {
      const f = happy();
      const r = await runNotifier({ env: { ...baseEnv, ALERT_EMAIL_DRY_RUN: v }, fetchImpl: f.impl });
      expect(r.status, String(v)).toBe("dry_run");
      expect(f.calls.map((c) => c.url), String(v)).toEqual(["https://proj.supabase.co/rest/v1/rpc/fn_preview_payment_notifications"]);
    }
    const f = happy();
    const unset = await runNotifier({ env: { ...baseEnv, ALERT_EMAIL_DRY_RUN: undefined }, fetchImpl: f.impl });
    expect(unset).toEqual({ status: "dry_run", mode: "unset", preview: { pending: 2 } });
    const typo = await runNotifier({ env: { ...baseEnv, ALERT_EMAIL_DRY_RUN: "Flase" }, fetchImpl: happy().impl });
    expect(typo).toEqual({ status: "dry_run", mode: "invalid", preview: { pending: 2 } });
    // the exact string "false" (with surrounding spaces tolerated) is the only way to send
    const live = happy();
    expect((await runNotifier({ env: { ...baseEnv, ALERT_EMAIL_DRY_RUN: " false " }, fetchImpl: live.impl })).status).toBe("ok");
    expect(live.calls.some((c) => c.url.includes("api.resend.com"))).toBe(true);
  });

  it("dry run needs no provider key and never claims or sends", async () => {
    const f = happy();
    const r = await runNotifier({ env: { ...baseEnv, ALERT_EMAIL_DRY_RUN: "true", RESEND_ALERT_API_KEY: "", ALERT_EMAIL_FROM: "" }, fetchImpl: f.impl });
    expect(r).toEqual({ status: "dry_run", mode: "true", preview: { pending: 2 } });
    expect(f.calls.map((c) => c.url)).toEqual(["https://proj.supabase.co/rest/v1/rpc/fn_preview_payment_notifications"]);
  });

  it("happy path: claim -> one e-mail with the database's frozen sender / recipients / key / text -> complete", async () => {
    const f = happy();
    const r = await runNotifier({ env: baseEnv, fetchImpl: f.impl });
    expect(r).toEqual({ status: "ok", processed: 1, sent: 1, failed: 0, last: "NOTHING" });
    const mail = f.calls.find((c) => c.url.includes("api.resend.com"))!;
    expect(mail.headers["Idempotency-Key"]).toBe("b-1-1");
    expect(mail.headers.Authorization).toBe(`Bearer ${RESEND}`);
    // sender, recipients, subject and text are exactly the frozen batch values (not rebuilt from env or from a fresh lookup)
    expect(mail.body).toEqual({ from: job.from, to: job.to, subject: job.subject, text: "isi" });
    expect(f.calls.some((c) => c.url.endsWith("fn_payment_notification_recipient_emails"))).toBe(false);
    const claim = f.calls.find((c) => c.url.endsWith("fn_claim_payment_notification_batch"))!;
    expect(claim.body).toEqual({ p_daily_limit: 20, p_critical_reserve: 5, p_max_items: 20, p_link: "https://app.example.test/ops/payments", p_from: baseEnv.ALERT_EMAIL_FROM });
    expect(claim.headers.apikey).toBe(SECRET);
    const done = f.calls.find((c) => c.url.endsWith("fn_complete_payment_notification_batch"))!;
    expect(done.body).toEqual({ p_batch_id: "b-1", p_provider_message_id: "msg_1" });
  });

  it("the daily limit can be lowered but never raised above 20", () => {
    const lim = (v: string) => {
      const r = readConfig({ ...baseEnv, ALERT_EMAIL_DAILY_LIMIT: v });
      return r.ok ? r.config.dailyLimit : -1;
    };
    expect(lim("5")).toBe(5);
    expect(lim("500")).toBe(20);
    expect(lim("0")).toBe(1);
    expect(lim("abc")).toBe(20);
  });

  it("classifies provider answers: 409 variants never rotate the key, 429, 5xx, auth, permanent 4xx, network, timeout", () => {
    const h = (status: number, json: unknown = null) => classifyResend({ ok: status < 300, status, json });
    expect(h(200, { id: "msg_9" })).toEqual({ kind: "sent", messageId: "msg_9" });
    expect(h(200, { id: "bad id with spaces" })).toEqual({ kind: "sent", messageId: null });
    expect(h(409, { name: "concurrent_idempotent_requests" })).toEqual({ kind: "fail", code: "HTTP_409_CONCURRENT", status: 409, permanent: false });
    expect(h(409, { name: "invalid_idempotent_request" })).toEqual({ kind: "fail", code: "HTTP_409_INVALID_IDEMPOTENT", status: 409, permanent: false });
    expect(h(429)).toEqual({ kind: "fail", code: "HTTP_429", status: 429, permanent: false });
    expect(h(503)).toEqual({ kind: "fail", code: "HTTP_5XX", status: 503, permanent: false });
    expect(h(401)).toEqual({ kind: "fail", code: "HTTP_401", status: 401, permanent: false });
    expect(h(403)).toEqual({ kind: "fail", code: "HTTP_403", status: 403, permanent: false });
    expect(h(422)).toEqual({ kind: "fail", code: "HTTP_422", status: 422, permanent: true });
    expect(h(400)).toEqual({ kind: "fail", code: "HTTP_400", status: 400, permanent: true });
    expect(classifyResend({ ok: false, status: 0, json: null, failed: "NETWORK" })).toEqual({ kind: "fail", code: "NETWORK", status: null, permanent: false });
    expect(classifyResend({ ok: false, status: 0, json: null, failed: "TIMEOUT" })).toEqual({ kind: "fail", code: "TIMEOUT", status: null, permanent: false });
  });

  it("a rejected e-mail is reported with a fixed code and the attempt number, never with a new key; no body or secret leaks", async () => {
    const logs: string[] = [];
    const f = happy({ resend: () => ({ status: 409, json: { name: "invalid_idempotent_request", message: `leak ${RESEND}` } }) });
    const r = await runNotifier({ env: baseEnv, fetchImpl: f.impl, log: (l) => logs.push(l) });
    expect(r).toEqual({ status: "ok", processed: 1, sent: 0, failed: 1, last: "NOTHING" });
    const fail = f.calls.find((c) => c.url.endsWith("fn_fail_payment_notification_batch"))!;
    expect(fail.body).toEqual({ p_batch_id: "b-1", p_attempt_no: 1, p_error_code: "HTTP_409_INVALID_IDEMPOTENT", p_http_status: 409, p_permanent: false });
    const everything = JSON.stringify([logs, r]);
    expect(everything).not.toContain(RESEND);
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain("op@example.test");
  });

  it("network errors and timeouts become transient failures; the thrown message (which may contain a secret) is never reported", async () => {
    for (const mode of ["throw", "abort"] as const) {
      const logs: string[] = [];
      const f = happy({ resend: () => mode });
      const r = await runNotifier({ env: baseEnv, fetchImpl: f.impl, log: (l) => logs.push(l) });
      expect(r.status).toBe("ok");
      const fail = f.calls.find((c) => c.url.endsWith("fn_fail_payment_notification_batch"))!;
      expect((fail.body as { p_error_code: string }).p_error_code).toBe(mode === "throw" ? "NETWORK" : "TIMEOUT");
      expect((fail.body as { p_permanent: boolean }).p_permanent).toBe(false);
      expect(JSON.stringify([logs, r])).not.toContain(SECRET);
    }
  });

  it("provider 401 / 403 (bad key or domain) is reported as a transient auth failure with its code: the database holds the batch, nothing is lost", async () => {
    for (const status of [401, 403]) {
      const f = happy({ resend: () => ({ status, json: { name: "restricted_api_key", message: `leak ${RESEND}` } }) });
      const r = await runNotifier({ env: baseEnv, fetchImpl: f.impl });
      expect(r).toEqual({ status: "ok", processed: 1, sent: 0, failed: 1, last: "NOTHING" });
      const fail = f.calls.find((c) => c.url.endsWith("fn_fail_payment_notification_batch"))!;
      expect(fail.body).toEqual({ p_batch_id: "b-1", p_attempt_no: 1, p_error_code: `HTTP_${status}`, p_http_status: status, p_permanent: false });
      expect(JSON.stringify(r)).not.toContain(RESEND);
    }
  });

  it("a retry sends the IDENTICAL frozen payload and key even if the environment changed meanwhile", async () => {
    const seen: string[] = [];
    let n = 0;
    const f = fake({
      fn_claim_payment_notification_batch: () => (++n <= 2 ? { json: { ...job, retry: n === 2, attempt_no: n } } : { json: { result: "NOTHING" } }),
      resend: (c) => {
        seen.push(JSON.stringify([c.body, c.headers["Idempotency-Key"]]));
        return n === 1 ? { status: 503 } : { json: { id: "m" } };
      },
      fn_fail_payment_notification_batch: () => ({ json: "RETRY" }),
      fn_complete_payment_notification_batch: () => ({ json: "SENT" }),
    });
    await runNotifier({ env: baseEnv, fetchImpl: f.impl });
    // the operator changed the sender in env between attempts: the frozen batch still wins
    await runNotifier({ env: { ...baseEnv, ALERT_EMAIL_FROM: "Other <other@example.test>" }, fetchImpl: f.impl });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });

  it("a claim that is not CLAIMED stops the run without sending (BUSY / DAILY_LIMIT / NO_RECIPIENT ...)", async () => {
    for (const result of ["BUSY", "DAILY_LIMIT", "RESERVE_HELD", "NO_RECIPIENT", "NOTHING"]) {
      const f = happy({ fn_claim_payment_notification_batch: () => ({ json: { result } }) });
      const r = await runNotifier({ env: baseEnv, fetchImpl: f.impl });
      expect(r).toEqual({ status: "ok", processed: 0, sent: 0, failed: 0, last: result });
      expect(f.calls.some((c) => c.url.includes("api.resend.com"))).toBe(false);
    }
  });

  it("a malformed claim answer is an error, never an e-mail", async () => {
    const f = happy({ fn_claim_payment_notification_batch: () => ({ json: { ...job, idempotency_key: "x".repeat(300) } }) });
    expect(await runNotifier({ env: baseEnv, fetchImpl: f.impl })).toEqual({ status: "error", code: "CLAIM_BAD_PAYLOAD" });
    const noTo = happy({ fn_claim_payment_notification_batch: () => ({ json: { ...job, to: [] } }) });
    expect(await runNotifier({ env: baseEnv, fetchImpl: noTo.impl })).toEqual({ status: "error", code: "CLAIM_BAD_PAYLOAD" });
    expect(noTo.calls.some((c) => c.url.includes("api.resend.com"))).toBe(false);
    const g = happy({ fn_claim_payment_notification_batch: () => ({ status: 500, json: { message: "boom" } }) });
    expect(await runNotifier({ env: baseEnv, fetchImpl: g.impl })).toEqual({ status: "error", code: "CLAIM_HTTP_500" });
  });

  it("a failed 'complete' after a provider success is not turned into a second e-mail in the same run", async () => {
    const f = happy({ fn_complete_payment_notification_batch: () => ({ status: 500 }) });
    const r = await runNotifier({ env: baseEnv, fetchImpl: f.impl });
    expect(r.status).toBe("ok");
    expect(f.calls.filter((c) => c.url.includes("api.resend.com"))).toHaveLength(1);
  });

  it("sends at most 3 batches per run", async () => {
    const f = fake({
      fn_claim_payment_notification_batch: () => ({ json: job }),
      resend: () => ({ json: { id: "m" } }),
      fn_complete_payment_notification_batch: () => ({ json: "SENT" }),
    });
    const r = await runNotifier({ env: baseEnv, fetchImpl: f.impl });
    expect(r).toEqual({ status: "ok", processed: 3, sent: 3, failed: 0, last: "SENT" });
  });

  it("the run summary is one safe line: numbers and fixed words only, no secret, address, tenant or free text", () => {
    const dry = summarize({
      status: "dry_run", mode: "unset",
      preview: { pending: 2, recipients: 1, batches_today: 3, last_run_at: "2026-11-01T00:00:00Z", leak: SECRET, email: "op@example.test", tenant: "Toko Maju", pending_critical: "7; drop" },
    });
    expect(dry).toBe("status=dry_run mode=unset pending=2 batches_today=3 recipients=1");
    expect(summarize({ status: "ok", processed: 2, sent: 1, failed: 1, last: "HTTP_5XX" })).toBe("status=ok processed=2 sent=1 failed=1 last=HTTP_5XX");
    expect(summarize({ status: "ok", processed: 1, sent: 0, failed: 1, last: `bad ${RESEND}` })).toBe("status=ok processed=1 sent=0 failed=1 last=UNKNOWN");
    expect(summarize({ status: "error", code: `x ${SECRET}` })).toBe("status=error code=UNKNOWN");
    expect(summarize({ status: "disabled" })).toBe("status=disabled");
    expect(summarize({ status: "misconfigured", missing: ["RESEND_ALERT_API_KEY", `weird ${SECRET}`] })).toBe("status=misconfigured missing=RESEND_ALERT_API_KEY");
    for (const line of [dry, summarize({ status: "misconfigured", missing: ["ALERT_EMAIL_FROM(invalid)"] })]) {
      expect(line).not.toContain(SECRET);
      expect(line).not.toContain("@");
    }
  });
});
