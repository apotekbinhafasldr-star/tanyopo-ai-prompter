// @vitest-environment node
import { describe, expect, it } from "vitest";
import { runPendingSweep, summarizeSweep } from "../../../netlify/lib/pending-sweep-core";

const SECRET = "sweeper-TOPSECRET-123";
const env = {
  PAYMENT_SWEEPER_ENABLED: "true",
  PAYMENT_SWEEPER_SECRET: SECRET,
  PAYMENT_SWEEPER_BASE_URL: "https://app.example.test/",
};

function fake(status = 200, json: unknown = { data: { examined: 2, applied: 1, closed: 1 } }, throwing?: Error) {
  const calls: Array<{ url: string; init: { method: string; headers: Record<string, string>; redirect: string } }> = [];
  const impl = (async (url: string, init: never) => {
    calls.push({ url, init });
    if (throwing) throw throwing;
    return { ok: status >= 200 && status < 300, status, json: async () => json } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("C2 pending sweep trigger", () => {
  it("is disabled by default and by anything but the exact string 'true' — and never touches the network", async () => {
    for (const v of [undefined, "", "false", "TRUE", "1", " yes "]) {
      const f = fake();
      expect(await runPendingSweep({ env: { ...env, PAYMENT_SWEEPER_ENABLED: v }, fetchImpl: f.impl })).toEqual({ status: "disabled" });
      expect(f.calls).toHaveLength(0);
    }
  });

  it("reports the NAMES of missing configuration, never values, and does not call out", async () => {
    const f = fake();
    const r = await runPendingSweep({ env: { PAYMENT_SWEEPER_ENABLED: "true" }, fetchImpl: f.impl });
    expect(r).toEqual({ status: "misconfigured", missing: ["PAYMENT_SWEEPER_SECRET", "PAYMENT_SWEEPER_BASE_URL"] });
    const bad = await runPendingSweep({ env: { ...env, PAYMENT_SWEEPER_BASE_URL: "http://insecure.test" }, fetchImpl: f.impl });
    expect(bad).toEqual({ status: "misconfigured", missing: ["PAYMENT_SWEEPER_BASE_URL(invalid)"] });
    expect(f.calls).toHaveLength(0);
  });

  it("falls back to Netlify's URL variable for the base", async () => {
    const f = fake();
    const { PAYMENT_SWEEPER_BASE_URL: _omit, ...rest } = env;
    void _omit;
    await runPendingSweep({ env: { ...rest, URL: "https://site.netlify.app" }, fetchImpl: f.impl });
    expect(f.calls[0].url).toBe("https://site.netlify.app/api/internal/payments/sweep");
  });

  it("POSTs once with the bearer secret, without following redirects, and returns only counts", async () => {
    const f = fake();
    const r = await runPendingSweep({ env, fetchImpl: f.impl });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe("https://app.example.test/api/internal/payments/sweep");
    expect(f.calls[0].init.method).toBe("POST");
    expect(f.calls[0].init.headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(f.calls[0].init.redirect).toBe("manual");
    expect(r).toEqual({ status: "ok", examined: 2, applied: 1, closed: 1 });
    expect(summarizeSweep(r)).toBe("status=ok examined=2 applied=1 closed=1");
  });

  it("maps HTTP errors (including a blocked redirect) and network failures to fixed codes without leaking the secret", async () => {
    expect(await runPendingSweep({ env, fetchImpl: fake(307).impl })).toEqual({ status: "error", code: "HTTP_307" });
    expect(await runPendingSweep({ env, fetchImpl: fake(503).impl })).toEqual({ status: "error", code: "HTTP_503" });
    const net = await runPendingSweep({ env, fetchImpl: fake(200, null, new Error(`down ${SECRET}`)).impl });
    expect(net).toEqual({ status: "error", code: "NETWORK" });
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(await runPendingSweep({ env, fetchImpl: fake(200, null, abort).impl })).toEqual({ status: "error", code: "TIMEOUT" });
    for (const r of [net]) expect(JSON.stringify(r) + summarizeSweep(r)).not.toContain(SECRET);
  });

  it("tolerates a malformed success body", async () => {
    expect(await runPendingSweep({ env, fetchImpl: fake(200, "nope").impl })).toEqual({ status: "ok", examined: 0, applied: 0, closed: 0 });
  });
});
