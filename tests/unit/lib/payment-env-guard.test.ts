// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PRODUCTION_SUPABASE_REFS } from "@/lib/billing/providers/doku-sandbox-db-guard";
import { evaluatePaymentEnvironment } from "@/lib/billing/providers/payment-env-guard";

const PROD = PRODUCTION_SUPABASE_REFS[0];
const SANDBOX = "abcdefghij0123456789";
const OTHER = "zyxwvutsrq9876543210";
const urlOf = (ref: string) => `https://${ref}.supabase.co`;

function jwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "HS256", typ: "JWT" })}.${enc(payload)}.signature`;
}

describe("D3 guard — sandbox mode (database must be a non-production, allow-listed project)", () => {
  it("A1: a production database is refused, even upper-cased, with a trailing slash, or when allow-listed", () => {
    for (const url of [urlOf(PROD), `${urlOf(PROD).toUpperCase()}`, `${urlOf(PROD)}/`]) {
      expect(evaluatePaymentEnvironment({ mode: "sandbox", supabaseUrl: url, sandboxRefs: SANDBOX })).toEqual({ ok: false, reason: "DB_IS_PRODUCTION" });
    }
    expect(evaluatePaymentEnvironment({ mode: "sandbox", supabaseUrl: urlOf(SANDBOX), sandboxRefs: `${SANDBOX},${PROD}` })).toEqual({
      ok: false,
      reason: "ALLOWLIST_HAS_PRODUCTION",
    });
  });

  it("A2: an allow-listed non-production project is accepted (spaces and capitals in the list are tolerated)", () => {
    expect(evaluatePaymentEnvironment({ mode: "sandbox", supabaseUrl: urlOf(SANDBOX), sandboxRefs: SANDBOX })).toEqual({ ok: true, env: "sandbox", ref: SANDBOX });
    expect(evaluatePaymentEnvironment({ mode: "sandbox", supabaseUrl: urlOf(SANDBOX), sandboxRefs: ` ${OTHER} , ${SANDBOX.toUpperCase()} ` })).toEqual({
      ok: true,
      env: "sandbox",
      ref: SANDBOX,
    });
  });

  it("A3: an empty, malformed or non-matching allow-list keeps the adapter OFF", () => {
    for (const refs of [undefined, "", " ", ",", "short", `${SANDBOX}x`, OTHER]) {
      expect(evaluatePaymentEnvironment({ mode: "sandbox", supabaseUrl: urlOf(SANDBOX), sandboxRefs: refs })).toEqual({ ok: false, reason: "DB_NOT_ALLOWLISTED" });
    }
  });

  it("A4: a database identity that cannot be proven from the URL is refused", () => {
    for (const url of [undefined, "", "http://localhost:54321", "https://x.supabase.co", "https://db.example.com", `https://${SANDBOX}.supabase.co:8443`, `https://u:p@${SANDBOX}.supabase.co`, `http://${SANDBOX}.supabase.co`]) {
      expect(evaluatePaymentEnvironment({ mode: "sandbox", supabaseUrl: url, sandboxRefs: SANDBOX }), String(url)).toEqual({ ok: false, reason: "DB_IDENTITY_UNPROVABLE" });
    }
  });

  it("A5: a JWT service key must carry the same project ref; new-style keys skip the check", () => {
    const base = { mode: "sandbox", supabaseUrl: urlOf(SANDBOX), sandboxRefs: SANDBOX };
    expect(evaluatePaymentEnvironment({ ...base, serviceKey: jwt({ role: "service_role", ref: SANDBOX }) }).ok).toBe(true);
    for (const key of [jwt({ ref: PROD }), jwt({ ref: OTHER }), jwt({ role: "service_role" }), jwt({ ref: 123 })]) {
      expect(evaluatePaymentEnvironment({ ...base, serviceKey: key })).toEqual({ ok: false, reason: "KEY_PROJECT_MISMATCH" });
    }
    expect(evaluatePaymentEnvironment({ ...base, serviceKey: "sb_secret_abcdef" }).ok).toBe(true);
  });
});

describe("D3 guard — live mode (database must be a known production project, never in the sandbox list)", () => {
  it("A6: a production database that is not in the sandbox list is accepted", () => {
    expect(evaluatePaymentEnvironment({ mode: "live", supabaseUrl: urlOf(PROD), sandboxRefs: SANDBOX })).toEqual({ ok: true, env: "live", ref: PROD });
    expect(evaluatePaymentEnvironment({ mode: "live", supabaseUrl: urlOf(PROD), sandboxRefs: undefined })).toEqual({ ok: true, env: "live", ref: PROD });
  });

  it("A7: live on a non-production database is refused; live on a production ref that is also sandbox-listed is refused", () => {
    expect(evaluatePaymentEnvironment({ mode: "live", supabaseUrl: urlOf(SANDBOX), sandboxRefs: SANDBOX })).toEqual({ ok: false, reason: "LIVE_DB_NOT_PRODUCTION" });
    expect(evaluatePaymentEnvironment({ mode: "live", supabaseUrl: urlOf(PROD), sandboxRefs: ` ${PROD.toUpperCase()} ` })).toEqual({ ok: false, reason: "LIVE_REF_IN_SANDBOX_LIST" });
  });

  it("live also refuses an unprovable identity and a key from another project", () => {
    expect(evaluatePaymentEnvironment({ mode: "live", supabaseUrl: "https://db.example.com", sandboxRefs: "" })).toEqual({ ok: false, reason: "DB_IDENTITY_UNPROVABLE" });
    expect(evaluatePaymentEnvironment({ mode: "live", supabaseUrl: urlOf(PROD), sandboxRefs: "", serviceKey: jwt({ ref: SANDBOX }) })).toEqual({ ok: false, reason: "KEY_PROJECT_MISMATCH" });
    expect(evaluatePaymentEnvironment({ mode: "live", supabaseUrl: urlOf(PROD), sandboxRefs: "", serviceKey: jwt({ ref: PROD }) }).ok).toBe(true);
  });
});

describe("D3 guard — closed result set", () => {
  it("A9: an unknown mode is refused", () => {
    for (const mode of ["", "staging", "SANDBOX", "production"]) {
      expect(evaluatePaymentEnvironment({ mode, supabaseUrl: urlOf(SANDBOX), sandboxRefs: SANDBOX })).toEqual({ ok: false, reason: "MODE_UNKNOWN" });
    }
  });

  it("A8: a refusal carries only a closed reason code — never the URL, a project ref or a key", () => {
    const key = jwt({ ref: OTHER, role: "service_role" });
    const results = [
      evaluatePaymentEnvironment({ mode: "sandbox", supabaseUrl: urlOf(PROD), sandboxRefs: SANDBOX, serviceKey: key }),
      evaluatePaymentEnvironment({ mode: "sandbox", supabaseUrl: urlOf(SANDBOX), sandboxRefs: SANDBOX, serviceKey: key }),
      evaluatePaymentEnvironment({ mode: "live", supabaseUrl: urlOf(SANDBOX), sandboxRefs: SANDBOX, serviceKey: key }),
      evaluatePaymentEnvironment({ mode: "live", supabaseUrl: urlOf(PROD), sandboxRefs: PROD, serviceKey: key }),
    ];
    for (const result of results) {
      expect(result.ok).toBe(false);
      const text = JSON.stringify(result);
      expect(text).toMatch(/^\{"ok":false,"reason":"[A-Z_]+"\}$/);
      for (const secret of [PROD, SANDBOX, OTHER, key, "supabase.co"]) expect(text).not.toContain(secret);
    }
  });
});
