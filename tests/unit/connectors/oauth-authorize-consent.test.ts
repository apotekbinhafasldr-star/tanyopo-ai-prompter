// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  decision: { allowed: true, reason: "GRANTED" } as { allowed: boolean; reason: string },
  requireConsent: vi.fn(),
}));

vi.mock("@/services/session", () => ({ requireSessionContext: async () => ({ tenantId: "t1", userId: "u1", role: "owner" }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: vi.fn() }) }));
vi.mock("@/lib/crypto/token-cipher", () => ({ isTokenCipherConfigured: () => true }));
vi.mock("@/lib/connectors/get-connector", () => ({
  getConnector: () => ({ isConfigured: () => true, getAuthorizationUrl: (state: string) => `https://platform.example/auth?state=${state}` }),
}));
vi.mock("@/lib/consent/require-consent", () => ({
  requireConsent: (...args: unknown[]) => {
    h.requireConsent(...args);
    return Promise.resolve(h.decision);
  },
}));

import { handleConnectorOauthAuthorize } from "@/lib/connectors/oauth-authorize";

const call = () => handleConnectorOauthAuthorize(new NextRequest("https://app.example/api/connections/meta/authorize"), "META", "meta_oauth_state");
const errorOf = (res: Response) => new URL(res.headers.get("location") as string).searchParams.get("error");

describe("authorize: pemetaan alasan penolakan gerbang persetujuan ke kode galat", () => {
  beforeEach(() => h.requireConsent.mockReset());

  it.each(["NO_RECORD", "WITHDRAWN", "VERSION_OUTDATED"])("%s -> ?error=consent_required", async (reason) => {
    h.decision = { allowed: false, reason };
    expect(errorOf(await call())).toBe("consent_required");
  });

  it.each(["CHECK_FAILED", "NO_CLIENT", "UNKNOWN_CODE", "INACTIVE_CODE"])("%s -> ?error=consent_check_failed", async (reason) => {
    h.decision = { allowed: false, reason };
    expect(errorOf(await call())).toBe("consent_check_failed");
  });

  it("diizinkan: OAuth dimulai (redirect ke platform), gerbang dipanggil dengan pengguna dan tenant dari sesi", async () => {
    h.decision = { allowed: true, reason: "GRANTED" };
    const res = await call();
    expect(res.headers.get("location")).toMatch(/^https:\/\/platform\.example\/auth\?state=/);
    expect(h.requireConsent).toHaveBeenCalledWith("CONNECT_META", "u1", "t1");
  });

  it("literal requireConsent(consentCode, session.userId, session.tenantId) tidak berubah (perubahan subjek = pekerjaan Jalur 1)", () => {
    const src = readFileSync(path.resolve(__dirname, "../../../lib/connectors/oauth-authorize.ts"), "utf-8");
    expect(src).toContain("requireConsent(consentCode, session.userId, session.tenantId)");
  });
});
