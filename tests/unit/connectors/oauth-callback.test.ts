import { describe, expect, it, vi, beforeEach } from "vitest";

const TENANT = "tenant-1";

const state = vi.hoisted(() => ({
  role: "owner" as string,
  cookieValue: undefined as string | undefined,
  connector: null as unknown,
  upserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  deleted: [] as string[],
}));

vi.mock("@/lib/env", () => ({
  serverEnv: { tiktok: {} },
  publicEnv: { supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "pk" },
  isConnectorConfigured: () => true,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (state.cookieValue === undefined ? undefined : { value: state.cookieValue }),
    delete: (name: string) => state.deleted.push(name),
  }),
}));

vi.mock("@/services/session", () => ({
  requireSessionContext: async () => ({ role: state.role, tenantId: TENANT, userId: "user-1" }),
}));

vi.mock("@/lib/connectors/get-connector", () => ({
  getConnector: () => state.connector,
}));

vi.mock("@/lib/crypto/token-cipher", () => ({
  encryptToken: (plaintext: string) => `enc(${plaintext})`,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      upsert: (row: Record<string, unknown>) => {
        state.upserts.push({ table, row });
        return {
          select: () => ({ single: async () => ({ data: { id: "acct-1" }, error: null }) }),
          then: (resolve: (v: unknown) => void) => resolve({ error: null }),
        };
      },
      insert: async (row: Record<string, unknown>) => {
        state.upserts.push({ table, row });
        return { error: null };
      },
    }),
  }),
}));

import { handleConnectorOauthCallback } from "@/lib/connectors/oauth-callback";
import { isPublicAsset } from "@/proxy";

function req(query: string) {
  return { url: `https://app.example.com/api/connections/tiktok/callback${query}` } as unknown as Parameters<
    typeof handleConnectorOauthCallback
  >[0];
}

function location(res: Response) {
  return new URL(res.headers.get("location")!);
}

describe("handleConnectorOauthCallback — TikTok Login Kit path", () => {
  beforeEach(() => {
    state.role = "owner";
    state.cookieValue = `good-state:${TENANT}`;
    state.upserts = [];
    state.deleted = [];
    state.connector = {
      exchangeCodeForToken: vi.fn(async () => ({
        accessToken: "access-tok",
        refreshToken: "refresh-tok",
        expiresAt: new Date("2030-01-01T00:00:00Z"),
        scopes: ["user.info.basic"],
      })),
      getAccounts: vi.fn(async () => [{ id: "open_id_1", name: "Toko A" }]),
    };
  });

  it("rejects a state mismatch with invalid_state and never exchanges the code", async () => {
    const res = await handleConnectorOauthCallback(req("?code=c&state=other"), "TIKTOK", "tiktok_oauth_state");
    expect(location(res).searchParams.get("error")).toBe("invalid_state");
    expect((state.connector as { exchangeCodeForToken: ReturnType<typeof vi.fn> }).exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it("rejects a tenant mismatch in the cookie with invalid_state", async () => {
    state.cookieValue = "good-state:other-tenant";
    const res = await handleConnectorOauthCallback(req("?code=c&state=good-state"), "TIKTOK", "tiktok_oauth_state");
    expect(location(res).searchParams.get("error")).toBe("invalid_state");
  });

  it("rejects a missing cookie with invalid_state", async () => {
    state.cookieValue = undefined;
    const res = await handleConnectorOauthCallback(req("?code=c&state=good-state"), "TIKTOK", "tiktok_oauth_state");
    expect(location(res).searchParams.get("error")).toBe("invalid_state");
  });

  it("maps a provider error param (user cancelled) to denied", async () => {
    const res = await handleConnectorOauthCallback(
      req("?error=access_denied&error_description=x&state=good-state"),
      "TIKTOK",
      "tiktok_oauth_state",
    );
    expect(location(res).searchParams.get("error")).toBe("denied");
  });

  it("rejects non-owners", async () => {
    state.role = "marketing";
    const res = await handleConnectorOauthCallback(req("?code=c&state=good-state"), "TIKTOK", "tiktok_oauth_state");
    expect(location(res).searchParams.get("error")).toBe("owner_required");
  });

  it("on success upserts external_account_id = open_id and puts no token in the redirect", async () => {
    const res = await handleConnectorOauthCallback(req("?code=c&state=good-state"), "TIKTOK", "tiktok_oauth_state");
    const target = location(res);
    expect(target.searchParams.get("connected")).toBe("TIKTOK");
    expect(target.toString()).not.toMatch(/access-tok|refresh-tok|enc\(/);

    const account = state.upserts.find((u) => u.table === "prompter_connected_accounts")!.row;
    expect(account.platform).toBe("TIKTOK");
    expect(account.external_account_id).toBe("open_id_1");
    expect(account.scopes).toEqual(["user.info.basic"]);

    const creds = state.upserts.find((u) => u.table === "prompter_oauth_credentials")!.row;
    expect(creds.encrypted_access_token).toBe("enc(access-tok)");
    expect(state.deleted).toContain("tiktok_oauth_state");
  });

  it("maps a connector failure to connect_failed without echoing details", async () => {
    (state.connector as { exchangeCodeForToken: ReturnType<typeof vi.fn> }).exchangeCodeForToken.mockRejectedValue(
      new Error("TikTok token exchange gagal: secret-detail"),
    );
    const res = await handleConnectorOauthCallback(req("?code=c&state=good-state"), "TIKTOK", "tiktok_oauth_state");
    const target = location(res);
    expect(target.searchParams.get("error")).toBe("connect_failed");
    expect(target.toString()).not.toContain("secret-detail");
  });
});

describe("proxy — TikTok callback stays session-gated", () => {
  it("does not exempt /api/connections/tiktok/callback from cookie gating", () => {
    expect(isPublicAsset("/api/connections/tiktok/callback")).toBe(false);
    expect(isPublicAsset("/api/connections/tiktok/authorize")).toBe(false);
  });
});
