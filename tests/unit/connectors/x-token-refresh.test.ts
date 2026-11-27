// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ConnectorApiError, type ConnectorTokenResult } from "@/lib/connectors/types";
import { refreshXConnection, type XRefreshStore } from "@/lib/connectors/x-token-refresh";
import { createXClient } from "@/lib/connectors/x-api-client";

const enc = (s: string) => `enc(${s})`;
const dec = (s: string) => s.replace(/^enc\((.*)\)$/, "$1");

interface Saved {
  tenantId: string;
  accountId: string;
  encryptedAccessToken: string;
  encryptedRefreshToken: string | null;
  expiresAt: string | null;
}

function makeStore(opts: { rows?: Record<string, { accountId: string; rt: string | null }>; saveOk?: boolean } = {}) {
  const rows = opts.rows ?? { t1: { accountId: "a1", rt: enc("RT-OLD") } };
  const saved: Saved[] = [];
  const flagged: string[] = [];
  const loadedFor: string[] = [];
  const store: XRefreshStore = {
    load: async (tenantId) => {
      loadedFor.push(tenantId);
      const row = rows[tenantId];
      return row ? { accountId: row.accountId, encryptedRefreshToken: row.rt } : null;
    },
    save: async (tenantId, accountId, input) => {
      if (opts.saveOk === false) return false;
      saved.push({
        tenantId,
        accountId,
        encryptedAccessToken: input.encryptedAccessToken,
        encryptedRefreshToken: input.encryptedRefreshToken,
        expiresAt: input.expiresAt,
      });
      return true;
    },
    markActionRequired: async (tenantId, accountId) => {
      flagged.push(`${tenantId}/${accountId}`);
    },
  };
  return { store, saved, flagged, loadedFor };
}

const token = (over: Partial<ConnectorTokenResult> = {}): ConnectorTokenResult => ({
  accessToken: "AT-NEW",
  refreshToken: "RT-NEW",
  expiresAt: new Date("2026-11-15T12:00:00Z"),
  scopes: ["tweet.read", "users.read", "offline.access"],
  ...over,
});

describe("refreshXConnection", () => {
  it("memakai refresh token milik tenant sendiri, menyimpan token baru terenkripsi (rotasi) dan mengembalikan access token", async () => {
    const { store, saved, loadedFor } = makeStore();
    const used: string[] = [];
    const res = await refreshXConnection("t1", {
      store,
      encrypt: enc,
      decrypt: dec,
      refresh: async (rt) => {
        used.push(rt);
        return token();
      },
    });
    expect(res).toEqual({ ok: true, accessToken: "AT-NEW", expiresAt: new Date("2026-11-15T12:00:00Z") });
    expect(used).toEqual(["RT-OLD"]);
    expect(loadedFor).toEqual(["t1"]);
    expect(saved).toHaveLength(1);
    expect(saved[0].encryptedAccessToken).toBe("enc(AT-NEW)");
    expect(saved[0].encryptedRefreshToken).toBe("enc(RT-NEW)");
    expect(JSON.stringify(saved)).not.toContain('"AT-NEW"');
  });

  it("mempertahankan refresh token lama bila X tidak mengirim yang baru", async () => {
    const { store, saved } = makeStore();
    await refreshXConnection("t1", {
      store,
      encrypt: enc,
      decrypt: dec,
      refresh: async () => token({ refreshToken: undefined }),
    });
    expect(saved[0].encryptedRefreshToken).toBe("enc(RT-OLD)");
  });

  it("tenant lain tidak punya koneksi: tidak memanggil X", async () => {
    const { store } = makeStore();
    let called = false;
    const res = await refreshXConnection("t2", {
      store,
      encrypt: enc,
      decrypt: dec,
      refresh: async () => {
        called = true;
        return token();
      },
    });
    expect(res).toEqual({ ok: false, reason: "no_connection" });
    expect(called).toBe(false);
  });

  it("tanpa refresh token: ACTION_REQUIRED, tidak memanggil X", async () => {
    const { store, flagged } = makeStore({ rows: { t1: { accountId: "a1", rt: null } } });
    const res = await refreshXConnection("t1", {
      store,
      encrypt: enc,
      decrypt: dec,
      refresh: async () => token(),
    });
    expect(res).toEqual({ ok: false, reason: "no_refresh_token" });
    expect(flagged).toEqual(["t1/a1"]);
  });

  it("penolakan X (400/401) menandai ACTION_REQUIRED dan tidak menyimpan apa pun", async () => {
    for (const status of [400, 401]) {
      const { store, saved, flagged } = makeStore();
      const res = await refreshXConnection("t1", {
        store,
        encrypt: enc,
        decrypt: dec,
        refresh: async () => {
          throw new ConnectorApiError("X", "invalid_grant", { status });
        },
      });
      expect(res).toEqual({ ok: false, reason: "rejected" });
      expect(flagged).toEqual(["t1/a1"]);
      expect(saved).toHaveLength(0);
    }
  });

  it("galat sementara (5xx/jaringan) tidak mengubah status koneksi", async () => {
    const { store, flagged } = makeStore();
    const res = await refreshXConnection("t1", {
      store,
      encrypt: enc,
      decrypt: dec,
      refresh: async () => {
        throw new ConnectorApiError("X", "boom", { status: 503 });
      },
    });
    expect(res).toEqual({ ok: false, reason: "error" });
    expect(flagged).toEqual([]);
  });

  it("gagal menyimpan setelah rotasi: ACTION_REQUIRED, access token tidak dikembalikan", async () => {
    const { store, flagged } = makeStore({ saveOk: false });
    const res = await refreshXConnection("t1", {
      store,
      encrypt: enc,
      decrypt: dec,
      refresh: async () => token(),
    });
    expect(res).toEqual({ ok: false, reason: "save_failed" });
    expect(flagged).toEqual(["t1/a1"]);
  });

  it("permintaan refresh ke X memakai Basic auth, grant_type=refresh_token, dan tidak diulang", async () => {
    const calls: { url: string; auth: string | undefined; body: string }[] = [];
    const client = createXClient({
      fetch: async (url, init) => {
        calls.push({
          url,
          auth: (init?.headers as Record<string, string>).Authorization,
          body: String(init?.body),
        });
        return new Response(JSON.stringify({ error: "server_error" }), { status: 503 });
      },
      sleep: async () => {},
    });
    await expect(client.refreshToken({ clientId: "cid", clientSecret: "sec", refreshToken: "RT" })).rejects.toThrow();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.x.com/2/oauth2/token");
    expect(calls[0].auth).toBe(`Basic ${Buffer.from("cid:sec").toString("base64")}`);
    const body = new URLSearchParams(calls[0].body);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("RT");
  });
});
