// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  PRODUCTION_SUPABASE_REFS,
  evaluateSandboxDbGuard,
  projectRefFromSupabaseUrl,
} from "@/lib/billing/providers/doku-sandbox-db-guard";

const SANDBOX_REF = "abcdefghij0123456789";
const PROD_REF = "wjjyqovhmwenbcvbnkgx";
const url = (ref: string) => `https://${ref}.supabase.co`;
const jwt = (claims: object) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

describe("sandbox ↔ database guard (P1-C)", () => {
  it("knows the shared production project and never lets it through", () => {
    expect(PRODUCTION_SUPABASE_REFS).toContain(PROD_REF);
    for (const allowed of [SANDBOX_REF, PROD_REF, `${SANDBOX_REF},${PROD_REF}`, `${PROD_REF},${SANDBOX_REF}`, PROD_REF.toUpperCase()]) {
      expect(evaluateSandboxDbGuard({ supabaseUrl: url(PROD_REF), allowedRefs: allowed }), allowed).toMatchObject({ ok: false });
    }
    expect(evaluateSandboxDbGuard({ supabaseUrl: url(PROD_REF.toUpperCase()), allowedRefs: SANDBOX_REF })).toEqual({ ok: false, reason: "DB_IS_PRODUCTION" });
    expect(evaluateSandboxDbGuard({ supabaseUrl: `${url(PROD_REF)}/`, allowedRefs: SANDBOX_REF })).toEqual({ ok: false, reason: "DB_IS_PRODUCTION" });
  });

  it("a production ref anywhere in the allow-list is a configuration error: everything is refused", () => {
    expect(evaluateSandboxDbGuard({ supabaseUrl: url(SANDBOX_REF), allowedRefs: `${SANDBOX_REF},${PROD_REF}` })).toEqual({ ok: false, reason: "ALLOWLIST_HAS_PRODUCTION" });
  });

  it("allows only an explicitly allow-listed standard project URL", () => {
    expect(evaluateSandboxDbGuard({ supabaseUrl: url(SANDBOX_REF), allowedRefs: SANDBOX_REF })).toEqual({ ok: true, ref: SANDBOX_REF });
    expect(evaluateSandboxDbGuard({ supabaseUrl: url(SANDBOX_REF), allowedRefs: ` ${SANDBOX_REF.toUpperCase()} , zzzzzzzzzzzzzzzzzzzz ` })).toEqual({ ok: true, ref: SANDBOX_REF });
    expect(evaluateSandboxDbGuard({ supabaseUrl: url("zzzzzzzzzz9999999999"), allowedRefs: SANDBOX_REF })).toEqual({ ok: false, reason: "DB_NOT_ALLOWLISTED" });
  });

  it.each([undefined, "", "   ", ",", "not-a-ref", `${SANDBOX_REF},short`, "abcdefghij012345678", "abcdefghij01234567890"])("an unusable allow-list (%j) means OFF", (allowedRefs) => {
    expect(evaluateSandboxDbGuard({ supabaseUrl: url(SANDBOX_REF), allowedRefs })).toMatchObject({ ok: false });
  });

  it.each([
    undefined,
    "",
    "not a url",
    "http://abcdefghij0123456789.supabase.co",
    "https://abcdefghij0123456789.supabase.co:8443",
    "https://user:pw@abcdefghij0123456789.supabase.co",
    "https://abcdefghij0123456789.supabase.co.evil.com",
    "https://evil.com/abcdefghij0123456789.supabase.co",
    "https://x.abcdefghij0123456789.supabase.co",
    "https://placeholder.supabase.co",
    "https://localhost:54321",
    "http://127.0.0.1:54321",
    "https://db.example.com",
  ])("identity is unprovable for %j", (supabaseUrl) => {
    expect(projectRefFromSupabaseUrl(supabaseUrl)).toBeNull();
    expect(evaluateSandboxDbGuard({ supabaseUrl, allowedRefs: SANDBOX_REF })).toEqual({ ok: false, reason: "DB_IDENTITY_UNPROVABLE" });
  });

  it("a legacy JWT service key must carry the same ref as the URL; keys without a ref claim cannot be tied to it", () => {
    const ok = { supabaseUrl: url(SANDBOX_REF), allowedRefs: SANDBOX_REF };
    expect(evaluateSandboxDbGuard({ ...ok, serviceKey: jwt({ role: "service_role", ref: SANDBOX_REF }) })).toMatchObject({ ok: true });
    expect(evaluateSandboxDbGuard({ ...ok, serviceKey: jwt({ role: "service_role", ref: PROD_REF }) })).toEqual({ ok: false, reason: "KEY_PROJECT_MISMATCH" });
    expect(evaluateSandboxDbGuard({ ...ok, serviceKey: jwt({ role: "service_role" }) })).toEqual({ ok: false, reason: "KEY_PROJECT_MISMATCH" });
    expect(evaluateSandboxDbGuard({ ...ok, serviceKey: jwt({ role: "service_role", ref: 42 }) })).toEqual({ ok: false, reason: "KEY_PROJECT_MISMATCH" });
  });

  it("new-style / opaque keys carry no ref: the URL identity decides (they never RELAX any other rule)", () => {
    const ok = { supabaseUrl: url(SANDBOX_REF), allowedRefs: SANDBOX_REF };
    for (const serviceKey of [undefined, "", "sb_secret_abcdef", "a.b", "not-a-jwt"]) {
      expect(evaluateSandboxDbGuard({ ...ok, serviceKey }), String(serviceKey)).toMatchObject({ ok: true });
    }
    expect(evaluateSandboxDbGuard({ supabaseUrl: url(PROD_REF), allowedRefs: SANDBOX_REF, serviceKey: "sb_secret_abcdef" })).toMatchObject({ ok: false });
  });

  it("never echoes a key or URL in its verdict", () => {
    const verdict = evaluateSandboxDbGuard({ supabaseUrl: url(PROD_REF), allowedRefs: SANDBOX_REF, serviceKey: jwt({ ref: PROD_REF }) });
    expect(JSON.stringify(verdict)).not.toMatch(/eyJ|supabase\.co|sb_secret/);
  });
});
