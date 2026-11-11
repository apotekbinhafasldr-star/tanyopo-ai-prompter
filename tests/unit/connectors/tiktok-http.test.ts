// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectorApiError } from "@/lib/connectors/types";
import { describeSafeError } from "@/lib/connectors/safe-error-log";
import {
  TikTokApiError,
  classifyTikTokError,
  computeRetryDelayMs,
  tiktokHttp,
  tiktokUserMessage,
  unwrapMarketing,
  unwrapOpenApi,
} from "@/lib/connectors/tiktok-http";

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function stubFetch(...responses: (Response | Error)[]) {
  const queue = [...responses];
  const mock = vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error("unexpected extra fetch call");
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function thrown(fn: () => unknown): TikTokApiError {
  try {
    fn();
  } catch (error) {
    return error as TikTokApiError;
  }
  throw new Error("expected the call to throw");
}

const noSleep = () => {
  const sleeps: number[] = [];
  return { sleeps, sleep: async (ms: number) => void sleeps.push(ms) };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("computeRetryDelayMs", () => {
  it("doubles per attempt and respects the ceiling", () => {
    expect(computeRetryDelayMs(1, null, 500, 8000)).toBe(500);
    expect(computeRetryDelayMs(2, null, 500, 8000)).toBe(1000);
    expect(computeRetryDelayMs(3, null, 500, 8000)).toBe(2000);
    expect(computeRetryDelayMs(10, null, 500, 8000)).toBe(8000);
  });

  it("prefers Retry-After (seconds), capped by the ceiling, ignoring junk", () => {
    expect(computeRetryDelayMs(1, "2", 500, 8000)).toBe(2000);
    expect(computeRetryDelayMs(1, "120", 500, 8000)).toBe(8000);
    expect(computeRetryDelayMs(1, "soon", 500, 8000)).toBe(500);
  });
});

describe("tiktokHttp retry policy", () => {
  it("retries HTTP 429 even for non-idempotent calls, then returns the success", async () => {
    const fetchMock = stubFetch(json({}, 429), json({ ok: 1 }, 200));
    const { sleeps, sleep } = noSleep();
    const result = await tiktokHttp("https://x.test/a", { method: "POST" }, { sleep });
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([500]);
  });

  it("honours Retry-After on 429", async () => {
    stubFetch(json({}, 429, { "Retry-After": "3" }), json({}, 200));
    const { sleeps, sleep } = noSleep();
    await tiktokHttp("https://x.test/a", {}, { sleep });
    expect(sleeps).toEqual([3000]);
  });

  it("gives up after maxAttempts and returns the last 429 for the caller to map", async () => {
    const fetchMock = stubFetch(json({}, 429), json({}, 429), json({}, 429));
    const { sleep } = noSleep();
    const result = await tiktokHttp("https://x.test/a", {}, { sleep });
    expect(result.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("never exceeds the hard cap of 5 tries even if asked for more", async () => {
    const fetchMock = stubFetch(...Array.from({ length: 10 }, () => json({}, 429)));
    const { sleep } = noSleep();
    await tiktokHttp("https://x.test/a", {}, { sleep, maxAttempts: 50 });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("does NOT replay a non-idempotent call after a 5xx", async () => {
    const fetchMock = stubFetch(json({}, 503));
    const { sleeps, sleep } = noSleep();
    const result = await tiktokHttp("https://x.test/a", { method: "POST" }, { sleep });
    expect(result.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it("replays an idempotent call after 5xx", async () => {
    const fetchMock = stubFetch(json({}, 502), json({ ok: 1 }, 200));
    const { sleep } = noSleep();
    const result = await tiktokHttp("https://x.test/a", {}, { sleep, idempotent: true });
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry 4xx other than 429", async () => {
    const fetchMock = stubFetch(json({}, 400));
    const { sleep } = noSleep();
    const result = await tiktokHttp("https://x.test/a", {}, { sleep, idempotent: true });
    expect(result.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("network error: retried only when idempotent, and finally reported as NETWORK without provider detail", async () => {
    const fetchMock = stubFetch(new Error("ECONNRESET secret-in-url"), new Error("ECONNRESET"), new Error("ECONNRESET"));
    const { sleep } = noSleep();
    const error = await tiktokHttp("https://x.test/a?secret=abc", {}, { sleep, idempotent: true }).catch((e) => e);
    expect(error).toBeInstanceOf(TikTokApiError);
    expect(error.kind).toBe("NETWORK");
    expect(error.message).not.toContain("secret");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const once = stubFetch(new Error("boom"));
    const err2 = await tiktokHttp("https://x.test/a", {}, { sleep }).catch((e) => e);
    expect(err2.kind).toBe("NETWORK");
    expect(once).toHaveBeenCalledTimes(1);
  });

  it("treats an unreadable body as undefined rather than throwing", async () => {
    stubFetch(new Response("<html>", { status: 200 }));
    const result = await tiktokHttp("https://x.test/a", {});
    expect(result.body).toBeUndefined();
  });
});

describe("classifyTikTokError", () => {
  it.each([
    ["access_token_invalid", 401, "AUTH_EXPIRED"],
    ["scope_not_authorized", 401, "SCOPE_MISSING"],
    ["scope_permission_missed", 400, "SCOPE_MISSING"],
    ["rate_limit_exceeded", 429, "RATE_LIMITED"],
    ["spam_risk_too_many_posts", 403, "DAILY_CAP"],
    ["spam_risk_too_many_pending_share", 403, "DAILY_CAP"],
    ["reached_active_user_cap", 403, "DAILY_CAP"],
    ["unaudited_client_can_only_post_to_private_accounts", 403, "UNAUDITED_CLIENT"],
    ["spam_risk_user_banned_from_posting", 403, "USER_BANNED"],
    ["url_ownership_unverified", 403, "URL_UNVERIFIED"],
    ["privacy_level_option_mismatch", 403, "PRIVACY_MISMATCH"],
    ["invalid_param", 400, "INVALID_REQUEST"],
    ["invalid_params", 400, "INVALID_REQUEST"],
    ["internal_error", 500, "SERVER_ERROR"],
  ] as const)("%s (%s) -> %s", (code, status, kind) => {
    expect(classifyTikTokError({ code, status })).toBe(kind);
  });

  it("falls back to the HTTP status for unknown codes", () => {
    expect(classifyTikTokError({ status: 429 })).toBe("RATE_LIMITED");
    expect(classifyTikTokError({ status: 401, code: "weird" })).toBe("AUTH_EXPIRED");
    expect(classifyTikTokError({ status: 503 })).toBe("SERVER_ERROR");
    expect(classifyTikTokError({ status: 418 })).toBe("UNKNOWN");
  });
});

describe("TikTokApiError", () => {
  it("is a ConnectorApiError whose structured fields feed the safe logger and never the message", () => {
    const error = new TikTokApiError("provider text with token=abc", { kind: "AUTH_EXPIRED", status: 401, code: "access_token_invalid", logId: "L1" });
    expect(error).toBeInstanceOf(ConnectorApiError);
    expect(error.platform).toBe("TIKTOK");
    expect(error.requiresReconnect).toBe(true);
    expect(error.retryable).toBe(false);

    const summary = describeSafeError(error);
    expect(summary.errorName).toBe("TikTokApiError");
    expect(summary.httpStatus).toBe(401);
    expect(summary.type).toBe("AUTH_EXPIRED");
    expect(JSON.stringify(summary)).not.toContain("token=abc");
  });

  it("marks rate limits / 5xx / network as retryable but not as reconnect", () => {
    for (const kind of ["RATE_LIMITED", "SERVER_ERROR", "NETWORK"] as const) {
      const error = new TikTokApiError("x", { kind });
      expect(error.retryable).toBe(true);
      expect(error.requiresReconnect).toBe(false);
    }
  });

  it("has an Indonesian message for every kind", () => {
    expect(tiktokUserMessage("DAILY_CAP")).toMatch(/Batas harian/);
    expect(tiktokUserMessage("UNAUDITED_CLIENT")).toMatch(/SELF_ONLY/);
  });
});

describe("unwrapOpenApi", () => {
  it("returns data when error.code is ok", () => {
    const data = unwrapOpenApi({ status: 200, ok: true, body: { data: { a: 1 }, error: { code: "ok", message: "", log_id: "L" } } });
    expect(data).toEqual({ a: 1 });
  });

  it("treats HTTP 200 with a non-ok error.code as a failure", () => {
    const error = thrown(() =>
      unwrapOpenApi({
        status: 200,
        ok: true,
        body: { error: { code: "spam_risk_too_many_posts", message: "too many", log_id: "L9" } },
      }),
    );
    expect(error.kind).toBe("DAILY_CAP");
    expect(error.logId).toBe("L9");
    expect(error.message).toBe("too many");
  });

  it("parses the flat OAuth error shape", () => {
    const error = thrown(() =>
      unwrapOpenApi({ status: 400, ok: false, body: { error: "invalid_request", error_description: "bad code", log_id: "L2" } }),
    );
    expect(error.kind).toBe("INVALID_REQUEST");
    expect(error.message).toBe("bad code");
    expect(error.logId).toBe("L2");
  });

  it("returns flat token bodies and tolerates an empty success body", () => {
    expect(unwrapOpenApi({ status: 200, ok: true, body: { access_token: "t" } })).toEqual({ access_token: "t" });
    expect(unwrapOpenApi({ status: 200, ok: true, body: undefined })).toEqual({});
  });

  it("fails with a generic Indonesian message on an unreadable error response", () => {
    const error = thrown(() => unwrapOpenApi({ status: 502, ok: false, body: undefined }));
    expect(error.kind).toBe("SERVER_ERROR");
    expect(error.status).toBe(502);
  });
});

describe("unwrapMarketing", () => {
  it("returns data when code is 0", () => {
    expect(unwrapMarketing({ status: 200, ok: true, body: { code: 0, message: "OK", data: { x: 1 } } })).toEqual({ x: 1 });
  });

  it("fails on a non-zero code carried through verbatim, with request_id as logId", () => {
    const error = thrown(() =>
      unwrapMarketing({ status: 200, ok: true, body: { code: 40001, message: "bad", request_id: "R1" } }),
    );
    expect(error.code).toBe(40001);
    expect(error.message).toBe("bad");
    expect(error.logId).toBe("R1");
    expect(error.kind).toBe("UNKNOWN");
  });

  it("classifies by HTTP status when the HTTP layer failed", () => {
    const error = thrown(() => unwrapMarketing({ status: 429, ok: false, body: { code: 40100, message: "slow down" } }));
    expect(error.kind).toBe("RATE_LIMITED");
  });

  it("fails when the body has no code at all", () => {
    expect(() => unwrapMarketing({ status: 200, ok: true, body: undefined })).toThrow(TikTokApiError);
  });
});
