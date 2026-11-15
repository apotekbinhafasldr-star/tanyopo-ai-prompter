// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Pemetaan error callback X lewat route asli, fetch palsu, tanpa jaringan dan
 * tanpa database (getAccounts distub). Memastikan pesan berbeda untuk
 * "pengguna menolak" vs "X mengembalikan error" vs "X menolak penukaran token",
 * dan tidak ada token/kode/state/verifier di redirect atau log.
 */

const h = vi.hoisted(() => ({
  session: { tenantId: "t1", userId: "u1", role: "owner" } as any,
  jar: new Map<string, string>(),
  connector: null as any,
}));

vi.mock("@/services/session", () => ({ requireSessionContext: async () => h.session }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (h.jar.has(name) ? { value: h.jar.get(name) } : undefined),
    set: (name: string, value: string) => {
      h.jar.set(name, value);
    },
    delete: (arg: string | { name: string }) => {
      h.jar.delete(typeof arg === "string" ? arg : arg.name);
    },
  }),
}));
vi.mock("@/lib/connectors/get-connector", () => ({ getConnector: () => h.connector }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/env", () => ({
  serverEnv: {
    x: { clientId: "cid", clientSecret: "sec", redirectUri: "https://app.example/api/connections/x/callback" },
  },
  isConnectorConfigured: (c: Record<string, string | undefined>) => Object.values(c).every((v) => !!v),
}));

import { GET as xAuthorize } from "@/app/api/connections/x/authorize/route";
import { GET as xCallback } from "@/app/api/connections/x/callback/route";
import { XConnector } from "@/lib/connectors/x-connector";
import { createXClient } from "@/lib/connectors/x-api-client";

const originalKey = process.env.TOKEN_ENCRYPTION_KEY;
const req = (path: string) => new NextRequest(`https://app.example${path}`);
const location = (res: Response) => new URL(res.headers.get("location") as string);
let logs: string[];

function connectorReplying(status: number, body: unknown) {
  const client = createXClient({
    fetch: async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    sleep: async () => {},
  });
  return Object.assign(new XConnector(client, { pkceWired: true }), { getAccounts: async () => [] });
}

async function start(): Promise<{ state: string; verifier: string }> {
  const res = await xAuthorize(req("/api/connections/x/authorize"));
  const state = location(res).searchParams.get("state") as string;
  const verifier = (h.jar.get("x_oauth_verifier") as string).split(":")[3];
  return { state, verifier };
}

beforeEach(() => {
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64"); // kunci uji sekali pakai
  h.jar.clear();
  h.session = { tenantId: "t1", userId: "u1", role: "owner" };
  h.connector = connectorReplying(200, { access_token: "AT-SECRET", refresh_token: "RT-SECRET", expires_in: 7200 });
  logs = [];
  for (const m of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      logs.push(JSON.stringify(args));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
  else process.env.TOKEN_ENCRYPTION_KEY = originalKey;
});

describe("error callback X dipetakan", () => {
  it("access_denied = pengguna membatalkan -> denied", async () => {
    const { state } = await start();
    const res = await xCallback(req(`/api/connections/x/callback?error=access_denied&state=${state}`));
    expect(location(res).searchParams.get("error")).toBe("denied");
  });

  it("error OAuth lain dari X bukan pembatalan -> provider_error, nilai error tidak diteruskan", async () => {
    const { state } = await start();
    const res = await xCallback(req(`/api/connections/x/callback?error=server_error&state=${state}`));
    expect(location(res).searchParams.get("error")).toBe("provider_error");
    expect(location(res).toString()).not.toContain("server_error");
    expect(h.jar.has("x_oauth_verifier")).toBe(false);
  });

  it.each([400, 401, 402, 403])("penukaran token ditolak X (%i) -> provider_access", async (status) => {
    const { state, verifier } = await start();
    h.connector = connectorReplying(status, { error: "invalid_grant", error_description: `bad ${verifier} ${state}` });
    const res = await xCallback(req(`/api/connections/x/callback?code=AUTH-CODE&state=${state}`));
    expect(location(res).searchParams.get("error")).toBe("provider_access");
    const everything = location(res).toString() + logs.join("\n");
    for (const secret of [verifier, state, "AUTH-CODE"]) expect(everything).not.toContain(secret);
  });

  it("galat X lain (5xx) tetap connect_failed", async () => {
    const { state } = await start();
    h.connector = connectorReplying(503, { error: "unavailable" });
    const res = await xCallback(req(`/api/connections/x/callback?code=AUTH-CODE&state=${state}`));
    expect(location(res).searchParams.get("error")).toBe("connect_failed");
  });

  it("state tidak cocok ditolak (invalid_state) sebelum X dipanggil", async () => {
    await start();
    let called = false;
    h.connector = Object.assign(
      new XConnector(
        createXClient({
          fetch: async () => {
            called = true;
            return new Response("{}", { status: 200 });
          },
        }),
        { pkceWired: true },
      ),
      { getAccounts: async () => [] },
    );
    const res = await xCallback(req("/api/connections/x/callback?code=C&state=forged"));
    expect(location(res).searchParams.get("error")).toBe("invalid_state");
    expect(called).toBe(false);
  });

  it("verifier kedaluwarsa/hilang ditolak (invalid_state), kode tidak dipakai", async () => {
    const { state } = await start();
    h.jar.delete("x_oauth_verifier"); // cookie habis umur (300 dtk) di browser
    let called = false;
    h.connector = Object.assign(
      new XConnector(
        createXClient({
          fetch: async () => {
            called = true;
            return new Response("{}", { status: 200 });
          },
        }),
        { pkceWired: true },
      ),
      { getAccounts: async () => [] },
    );
    const res = await xCallback(req(`/api/connections/x/callback?code=C&state=${state}`));
    expect(location(res).searchParams.get("error")).toBe("invalid_state");
    expect(called).toBe(false);
  });

  it("Meta/TikTok tidak berubah: error apa pun tetap denied (hanya konektor PKCE yang membedakan)", async () => {
    h.connector = { platform: "META", isConfigured: () => true };
    const res = await xCallback(req("/api/connections/x/callback?error=server_error&state=s"));
    expect(location(res).searchParams.get("error")).toBe("denied");
  });
});
