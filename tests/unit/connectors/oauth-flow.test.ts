// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { decryptToken } from "@/lib/crypto/token-cipher";
import { ConnectorConfigError } from "@/lib/connectors/types";
import { GET as metaCallback } from "@/app/api/connections/meta/callback/route";
import { GET as tiktokCallback } from "@/app/api/connections/tiktok/callback/route";
import { GET as xCallback } from "@/app/api/connections/x/callback/route";
import { GET as metaAuthorize } from "@/app/api/connections/meta/authorize/route";
import { GET as tiktokAuthorize } from "@/app/api/connections/tiktok/authorize/route";
import { GET as xAuthorize } from "@/app/api/connections/x/authorize/route";

/**
 * End-to-end tests of the shared OAuth authorize/callback handlers for
 * META, TIKTOK and X (through the real route files, so the per-platform
 * cookie names are covered too). Everything external is faked: session,
 * cookies, connector HTTP calls, and Supabase (an in-memory fake that
 * enforces the real UNIQUE/FK/CASCADE behaviour and can inject failures).
 *
 * The central invariant, checked after EVERY write of EVERY scenario:
 *   a prompter_connected_accounts row is never CONNECTED unless an
 *   encrypted credentials row exists for it.
 */

type Row = Record<string, any>;

interface FakeDb {
  accounts: Row[];
  creds: Row[];
  audits: Row[];
  ops: { table: string; op: string; payload: any; filters: Record<string, unknown> }[];
  violations: string[];
  /** Return an error code to make that statement fail (nothing is applied). */
  failWhen?: (ctx: { table: string; op: string; payload: any; filters: Record<string, unknown> }) => string | null;
  /** Runs right before a statement executes (to simulate concurrent changes). */
  beforeExec?: (ctx: { table: string; op: string }) => void;
  nextId: number;
}

const h = vi.hoisted(() => ({
  session: { tenantId: "t1", userId: "u1", role: "owner" } as any,
  jar: new Map<string, string>(),
  cookieSets: [] as { name: string; value: string; opts: any }[],
  db: null as any,
  adminAvailable: true,
  connector: null as any,
  connectorAvailable: true,
}));

vi.mock("@/services/session", () => ({ requireSessionContext: async () => h.session }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (h.jar.has(name) ? { value: h.jar.get(name) } : undefined),
    set: (name: string, value: string, opts: any) => {
      h.jar.set(name, value);
      h.cookieSets.push({ name, value, opts });
    },
    delete: (name: string) => {
      h.jar.delete(name);
    },
  }),
}));

vi.mock("@/lib/connectors/get-connector", () => ({
  getConnector: () => (h.connectorAvailable ? h.connector : null),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => (h.adminAvailable ? makeClient(h.db as FakeDb) : null),
}));

function checkInvariant(db: FakeDb, after: string) {
  for (const a of db.accounts) {
    if (a.status === "CONNECTED" && !db.creds.some((c) => c.connected_account_id === a.id)) {
      db.violations.push(`CONNECTED without credentials after ${after} (account ${a.id})`);
    }
  }
}

function matches(row: Row, filters: Record<string, unknown>) {
  return Object.entries(filters).every(([k, v]) => row[k] === v);
}

function makeClient(db: FakeDb) {
  return {
    from(table: string) {
      const st: { op: string | null; payload: any; filters: Record<string, unknown>; returning: boolean; mode: string | null; opts: any } = {
        op: null,
        payload: null,
        filters: {},
        returning: false,
        mode: null,
        opts: null,
      };
      const exec = (): { data: any; error: any } => {
        const op = st.op as string;
        db.beforeExec?.({ table, op });
        const injected = db.failWhen?.({ table, op, payload: st.payload, filters: st.filters });
        if (injected) return { data: null, error: { code: injected } };
        db.ops.push({ table, op, payload: st.payload, filters: { ...st.filters } });

        if (table === "prompter_connected_accounts") {
          if (op === "select") {
            const rows = db.accounts.filter((r) => matches(r, st.filters));
            return { data: st.mode === "maybe" ? (rows[0] ?? null) : rows, error: null };
          }
          if (op === "insert") {
            const dup = db.accounts.some(
              (r) => r.tenant_id === st.payload.tenant_id && r.platform === st.payload.platform,
            );
            if (dup) return { data: null, error: { code: "23505" } };
            // Real column default when status is not supplied.
            const row = { status: "CONNECTED", ...st.payload, id: `acct_${db.nextId++}` };
            db.accounts.push(row);
            checkInvariant(db, "insert");
            return { data: st.mode === "single" ? { id: row.id } : null, error: null };
          }
          if (op === "update") {
            const rows = db.accounts.filter((r) => matches(r, st.filters));
            rows.forEach((r) => Object.assign(r, st.payload));
            checkInvariant(db, `update ${JSON.stringify(st.payload.status ?? "")}`);
            return { data: st.returning ? rows.map((r) => ({ id: r.id })) : null, error: null };
          }
          if (op === "delete") {
            const gone = db.accounts.filter((r) => matches(r, st.filters));
            db.accounts = db.accounts.filter((r) => !gone.includes(r));
            // ON DELETE CASCADE
            db.creds = db.creds.filter((c) => !gone.some((g) => g.id === c.connected_account_id));
            checkInvariant(db, "delete");
            return { data: null, error: null };
          }
        }

        if (table === "prompter_oauth_credentials" && op === "upsert") {
          const parent = db.accounts.find((a) => a.id === st.payload.connected_account_id);
          if (!parent) return { data: null, error: { code: "23503" } }; // FK
          const i = db.creds.findIndex((c) => c.connected_account_id === st.payload.connected_account_id);
          if (i >= 0) db.creds[i] = { ...db.creds[i], ...st.payload };
          else db.creds.push({ ...st.payload });
          checkInvariant(db, "credentials upsert");
          return { data: null, error: null };
        }

        if (table === "prompter_audit_logs" && op === "insert") {
          db.audits.push(st.payload);
          return { data: null, error: null };
        }

        throw new Error(`unexpected statement ${table}.${op}`);
      };

      const b: any = {
        select() {
          if (!st.op) st.op = "select";
          else st.returning = true;
          return b;
        },
        insert(p: any) {
          st.op = "insert";
          st.payload = p;
          return b;
        },
        upsert(p: any, o: any) {
          st.op = "upsert";
          st.payload = p;
          st.opts = o;
          return b;
        },
        update(p: any) {
          st.op = "update";
          st.payload = p;
          return b;
        },
        delete() {
          st.op = "delete";
          return b;
        },
        eq(k: string, v: unknown) {
          st.filters[k] = v;
          return b;
        },
        maybeSingle() {
          st.mode = "maybe";
          return b;
        },
        single() {
          st.mode = "single";
          return b;
        },
        then(res: any, rej: any) {
          return Promise.resolve(exec()).then(res, rej);
        },
      };
      return b;
    },
  };
}

function newDb(): FakeDb {
  return { accounts: [], creds: [], audits: [], ops: [], violations: [], nextId: 1 };
}

const PLATFORMS = [
  { platform: "META", cookie: "meta_oauth_state", callback: metaCallback, authorize: metaAuthorize },
  { platform: "TIKTOK", cookie: "tiktok_oauth_state", callback: tiktokCallback, authorize: tiktokAuthorize },
  { platform: "X", cookie: "x_oauth_state", callback: xCallback, authorize: xAuthorize },
] as const;

const ACCESS = "plain-access-token-AAA";
const REFRESH = "plain-refresh-token-BBB";
const originalKey = process.env.TOKEN_ENCRYPTION_KEY;

function req(path: string) {
  return new NextRequest(`https://app.test${path}`);
}
function location(res: Response) {
  return new URL(res.headers.get("location") as string);
}
function callbackReq(platform: string, query = "code=CODE&state=STATE") {
  return req(`/api/connections/${platform.toLowerCase()}/callback?${query}`);
}
function db(): FakeDb {
  return h.db as FakeDb;
}
function seedExisting(overrides: Row = {}) {
  db().accounts.push({
    id: "acct_old",
    tenant_id: "t1",
    platform: "META",
    external_account_id: "act_OLD",
    external_account_name: "Old Account",
    status: "CONNECTED",
    scopes: ["old_scope"],
    selected_page_id: "page_1",
    selected_page_name: "Page One",
    ...overrides,
  });
  db().creds.push({
    tenant_id: "t1",
    connected_account_id: "acct_old",
    encrypted_access_token: "OLD-CIPHER-ACCESS",
    encrypted_refresh_token: "OLD-CIPHER-REFRESH",
  });
}

beforeEach(() => {
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64"); // throwaway test key
  h.session = { tenantId: "t1", userId: "u1", role: "owner" };
  h.jar.clear();
  h.cookieSets.length = 0;
  h.db = newDb();
  h.adminAvailable = true;
  h.connectorAvailable = true;
  h.connector = {
    getAuthorizationUrl: vi.fn((state: string) => `https://auth.example/dialog?state=${state}`),
    exchangeCodeForToken: vi.fn(async () => ({
      accessToken: ACCESS,
      refreshToken: REFRESH,
      scopes: ["s1", "s2"],
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    })),
    getAccounts: vi.fn(async () => [
      { id: "act_NEW", name: "New Account" },
      { id: "act_SECOND", name: "Second" },
    ]),
  };
});

afterEach(() => {
  expect(db().violations).toEqual([]); // invariant held in every scenario
  if (originalKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
  else process.env.TOKEN_ENCRYPTION_KEY = originalKey;
});

describe.each(PLATFORMS)("authorize — $platform", ({ platform, cookie, authorize }) => {
  it("redirects to the platform and stores state bound to the tenant", async () => {
    const res = await authorize(req(`/api/connections/${platform}/authorize`));
    const target = location(res);
    expect(target.origin).toBe("https://auth.example");
    const state = target.searchParams.get("state") as string;
    expect(state.length).toBeGreaterThanOrEqual(30);
    expect(h.cookieSets).toHaveLength(1);
    expect(h.cookieSets[0].name).toBe(cookie);
    expect(h.cookieSets[0].value).toBe(`${state}:t1`);
    expect(h.cookieSets[0].opts).toMatchObject({ httpOnly: true, sameSite: "lax", maxAge: 300 });
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["not base64 32 bytes", Buffer.alloc(16, 1).toString("base64")],
  ])("refuses BEFORE redirecting when the encryption key is %s", async (_label, value) => {
    if (value === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = value;

    const res = await authorize(req(`/api/connections/${platform}/authorize`));
    const target = location(res);
    expect(target.pathname).toBe("/connections");
    expect(target.searchParams.get("error")).toBe("encryption_not_configured");
    expect(h.connector.getAuthorizationUrl).not.toHaveBeenCalled();
    expect(h.cookieSets).toHaveLength(0);
  });

  it("is owner-only", async () => {
    h.session = { tenantId: "t1", userId: "u2", role: "member" };
    const res = await authorize(req(`/api/connections/${platform}/authorize`));
    expect(location(res).searchParams.get("error")).toBe("owner_required");
    expect(h.connector.getAuthorizationUrl).not.toHaveBeenCalled();
    expect(h.cookieSets).toHaveLength(0);
  });

  it("maps a connector configuration error to not_configured without a cookie", async () => {
    h.connector.getAuthorizationUrl = vi.fn(() => {
      throw new ConnectorConfigError(platform, "missing app id");
    });
    const res = await authorize(req(`/api/connections/${platform}/authorize`));
    expect(location(res).searchParams.get("error")).toBe("not_configured");
    expect(h.cookieSets).toHaveLength(0);
  });
});

describe.each(PLATFORMS)("callback — $platform", ({ platform, cookie, callback }) => {
  function arm(state = "STATE", tenant = "t1") {
    h.jar.set(cookie, `${state}:${tenant}`);
  }
  async function run(query?: string) {
    return callback(callbackReq(platform, query));
  }
  /** Platform column of the fake rows must match the platform under test. */
  function seed(overrides: Row = {}) {
    seedExisting({ platform, ...overrides });
  }

  describe("new connection", () => {
    it("stores encrypted credentials BEFORE marking the account CONNECTED", async () => {
      arm();
      const res = await run();

      expect(location(res).searchParams.get("connected")).toBe(platform);
      expect(db().accounts).toHaveLength(1);
      const account = db().accounts[0];
      expect(account).toMatchObject({
        tenant_id: "t1",
        platform,
        status: "CONNECTED",
        external_account_id: "act_NEW",
        connected_by: "u1",
      });

      const cred = db().creds[0];
      expect(cred.connected_account_id).toBe(account.id);
      expect(cred.encrypted_access_token).not.toContain(ACCESS);
      expect(decryptToken(cred.encrypted_access_token)).toBe(ACCESS);
      expect(decryptToken(cred.encrypted_refresh_token)).toBe(REFRESH);

      const order = db().ops.map((o) => `${o.table}.${o.op}${o.payload?.status ? ":" + o.payload.status : ""}`);
      expect(order.indexOf("prompter_oauth_credentials.upsert")).toBeGreaterThan(-1);
      expect(order.indexOf("prompter_connected_accounts.insert:ACTION_REQUIRED")).toBeLessThan(
        order.indexOf("prompter_oauth_credentials.upsert"),
      );
      expect(order.indexOf("prompter_oauth_credentials.upsert")).toBeLessThan(
        order.indexOf("prompter_connected_accounts.update:CONNECTED"),
      );
      // The row is never inserted as CONNECTED.
      expect(order).not.toContain("prompter_connected_accounts.insert:CONNECTED");
      expect(db().audits).toHaveLength(1);
    });

    it("never puts a token in the redirect URL", async () => {
      arm();
      const res = await run();
      const url = res.headers.get("location") as string;
      expect(url).not.toContain(ACCESS);
      expect(url).not.toContain(REFRESH);
    });

    it("stores no refresh token when the platform returns none", async () => {
      h.connector.exchangeCodeForToken = vi.fn(async () => ({ accessToken: ACCESS, scopes: [] }));
      arm();
      await run();
      expect(db().creds[0].encrypted_refresh_token).toBeNull();
      expect(db().accounts[0].status).toBe("CONNECTED");
    });

    it("refuses with an invalid key BEFORE exchanging the code or writing anything", async () => {
      process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(8, 7).toString("base64");
      arm();
      const res = await run();
      expect(location(res).searchParams.get("error")).toBe("encryption_not_configured");
      expect(h.connector.exchangeCodeForToken).not.toHaveBeenCalled();
      expect(db().ops).toHaveLength(0);
      expect(db().accounts).toHaveLength(0);
    });

    it("refuses with a missing key BEFORE exchanging the code", async () => {
      delete process.env.TOKEN_ENCRYPTION_KEY;
      arm();
      const res = await run();
      expect(location(res).searchParams.get("error")).toBe("encryption_not_configured");
      expect(h.connector.exchangeCodeForToken).not.toHaveBeenCalled();
      expect(db().ops).toHaveLength(0);
    });

    it("leaves NO account when the credentials write fails", async () => {
      db().failWhen = ({ table }) => (table === "prompter_oauth_credentials" ? "XX000" : null);
      arm();
      const res = await run();
      expect(location(res).searchParams.get("error")).toBe("save_failed");
      expect(db().accounts).toHaveLength(0);
      expect(db().creds).toHaveLength(0);
      expect(db().audits).toHaveLength(0);
    });

    it("leaves NO CONNECTED account when the credentials write AND the cleanup both fail", async () => {
      db().failWhen = ({ table, op }) =>
        table === "prompter_oauth_credentials" || (table === "prompter_connected_accounts" && op === "delete")
          ? "XX000"
          : null;
      arm();
      const res = await run();
      expect(location(res).searchParams.get("error")).toBe("save_failed");
      expect(db().accounts.every((a) => a.status !== "CONNECTED")).toBe(true);
    });

    it("removes the new row when activation fails", async () => {
      db().failWhen = ({ table, op, payload }) =>
        table === "prompter_connected_accounts" && op === "update" && payload.status === "CONNECTED" ? "XX000" : null;
      arm();
      const res = await run();
      expect(location(res).searchParams.get("error")).toBe("save_failed");
      expect(db().accounts).toHaveLength(0);
      expect(db().creds).toHaveLength(0);
    });

    it("reports save_failed when the account insert fails (nothing to clean up)", async () => {
      db().failWhen = ({ table, op }) => (table === "prompter_connected_accounts" && op === "insert" ? "XX000" : null);
      arm();
      const res = await run();
      expect(location(res).searchParams.get("error")).toBe("save_failed");
      expect(db().accounts).toHaveLength(0);
      expect(db().ops.some((o) => o.table === "prompter_oauth_credentials")).toBe(false);
    });

    it("reports save_failed when the existing-account lookup fails, writing nothing", async () => {
      db().failWhen = ({ table, op }) => (table === "prompter_connected_accounts" && op === "select" ? "XX000" : null);
      arm();
      const res = await run();
      expect(location(res).searchParams.get("error")).toBe("save_failed");
      expect(db().ops).toHaveLength(0);
    });

    it("does not delete a row it did not create when a concurrent connect wins the insert race", async () => {
      // Another request inserts the (tenant, platform) row between our
      // lookup and our insert: our insert hits the UNIQUE constraint.
      let injected = false;
      db().beforeExec = ({ table, op }) => {
        if (!injected && table === "prompter_connected_accounts" && op === "insert") {
          injected = true;
          seed({ id: "acct_race" });
        }
      };
      arm();
      const res = await run();
      expect(location(res).searchParams.get("error")).toBe("save_failed");
      expect(db().accounts.map((a) => a.id)).toEqual(["acct_race"]);
      expect(db().ops.some((o) => o.op === "delete")).toBe(false);
    });

    it("stays successful when only the audit log insert fails", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      db().failWhen = ({ table }) => (table === "prompter_audit_logs" ? "XX000" : null);
      arm();
      const res = await run();
      expect(location(res).searchParams.get("connected")).toBe(platform);
      expect(db().accounts[0].status).toBe("CONNECTED");
      expect(spy).toHaveBeenCalled();
      expect(JSON.stringify(spy.mock.calls)).not.toContain(ACCESS);
      spy.mockRestore();
    });
  });

  describe("reconnect (existing account)", () => {
    it("replaces credentials on the SAME row, never deletes it, and keeps the selected Page", async () => {
      seed();
      arm();
      const res = await run();

      expect(location(res).searchParams.get("connected")).toBe(platform);
      expect(db().accounts).toHaveLength(1);
      expect(db().accounts[0]).toMatchObject({
        id: "acct_old",
        status: "CONNECTED",
        external_account_id: "act_NEW",
        selected_page_id: "page_1",
        selected_page_name: "Page One",
      });
      expect(db().creds).toHaveLength(1);
      expect(decryptToken(db().creds[0].encrypted_access_token)).toBe(ACCESS);
      expect(db().ops.some((o) => o.op === "delete")).toBe(false);

      // Taken out of CONNECTED before credentials change, back after.
      const order = db().ops.map((o) => `${o.table}.${o.op}${o.payload?.status ? ":" + o.payload.status : ""}`);
      expect(order.indexOf("prompter_connected_accounts.update:ACTION_REQUIRED")).toBeLessThan(
        order.indexOf("prompter_oauth_credentials.upsert"),
      );
      expect(order.indexOf("prompter_oauth_credentials.upsert")).toBeLessThan(
        order.indexOf("prompter_connected_accounts.update:CONNECTED"),
      );
    });

    it("keeps the OLD connection intact (credentials, metadata, status) when the credentials write fails", async () => {
      seed();
      db().failWhen = ({ table }) => (table === "prompter_oauth_credentials" ? "XX000" : null);
      arm();
      const res = await run();

      expect(location(res).searchParams.get("error")).toBe("save_failed");
      expect(db().accounts).toHaveLength(1);
      expect(db().accounts[0]).toMatchObject({
        id: "acct_old",
        status: "CONNECTED", // restored
        external_account_id: "act_OLD",
        scopes: ["old_scope"],
      });
      expect(db().creds[0].encrypted_access_token).toBe("OLD-CIPHER-ACCESS");
      expect(db().ops.some((o) => o.op === "delete")).toBe(false);
    });

    it("restores the exact previous status (e.g. EXPIRED) after a failed credentials write", async () => {
      seed({ status: "EXPIRED" });
      db().failWhen = ({ table }) => (table === "prompter_oauth_credentials" ? "XX000" : null);
      arm();
      await run();
      expect(db().accounts[0].status).toBe("EXPIRED");
    });

    it("fails closed (ACTION_REQUIRED, row kept) when the restore itself also fails", async () => {
      seed();
      db().failWhen = ({ table, op, payload }) =>
        table === "prompter_oauth_credentials" ||
        (table === "prompter_connected_accounts" && op === "update" && payload.status === "CONNECTED")
          ? "XX000"
          : null;
      arm();
      await run();
      expect(db().accounts).toHaveLength(1);
      expect(db().accounts[0].status).toBe("ACTION_REQUIRED");
    });

    it("changes nothing when demoting the live account fails", async () => {
      seed();
      db().failWhen = ({ table, op }) => (table === "prompter_connected_accounts" && op === "update" ? "XX000" : null);
      arm();
      const res = await run();
      expect(location(res).searchParams.get("error")).toBe("save_failed");
      expect(db().accounts[0]).toMatchObject({ status: "CONNECTED", external_account_id: "act_OLD" });
      expect(db().creds[0].encrypted_access_token).toBe("OLD-CIPHER-ACCESS");
      expect(db().ops.some((o) => o.table === "prompter_oauth_credentials")).toBe(false);
    });

    it("keeps the row but NOT CONNECTED when activation fails after credentials were replaced", async () => {
      seed();
      db().failWhen = ({ table, op, payload }) =>
        table === "prompter_connected_accounts" && op === "update" && payload.status === "CONNECTED" ? "XX000" : null;
      arm();
      const res = await run();
      expect(location(res).searchParams.get("error")).toBe("save_failed");
      expect(db().accounts).toHaveLength(1);
      expect(db().accounts[0].status).toBe("ACTION_REQUIRED");
      expect(db().ops.some((o) => o.op === "delete")).toBe(false);
    });

    it("does not report success if the account is disconnected concurrently (row vanishes mid-flow)", async () => {
      seed();
      let removed = false;
      db().beforeExec = ({ table, op }) => {
        if (!removed && table === "prompter_oauth_credentials" && op === "upsert") {
          removed = true;
          db().accounts = [];
          db().creds = []; // ON DELETE CASCADE from the concurrent disconnect
        }
      };
      arm();
      const res = await run();
      expect(location(res).searchParams.get("error")).toBe("save_failed");
      expect(db().accounts).toHaveLength(0);
      expect(db().creds).toHaveLength(0); // no orphan credentials
    });
  });

  describe("tenant isolation", () => {
    it("rejects state minted for a different tenant, before any exchange or write", async () => {
      arm("STATE", "t2");
      const res = await run();
      expect(location(res).searchParams.get("error")).toBe("invalid_state");
      expect(h.connector.exchangeCodeForToken).not.toHaveBeenCalled();
      expect(db().ops).toHaveLength(0);
    });

    it("never reads or modifies another tenant's connection, and scopes every write by tenant", async () => {
      db().accounts.push({
        id: "acct_other",
        tenant_id: "t2",
        platform,
        external_account_id: "act_T2",
        status: "CONNECTED",
      });
      db().creds.push({ tenant_id: "t2", connected_account_id: "acct_other", encrypted_access_token: "T2-CIPHER" });
      arm();
      await run();

      expect(db().accounts.find((a) => a.id === "acct_other")).toMatchObject({
        tenant_id: "t2",
        external_account_id: "act_T2",
        status: "CONNECTED",
      });
      expect(db().creds.find((c) => c.connected_account_id === "acct_other")?.encrypted_access_token).toBe("T2-CIPHER");
      expect(db().accounts.filter((a) => a.tenant_id === "t1")).toHaveLength(1);

      for (const o of db().ops.filter((x) => x.table === "prompter_connected_accounts")) {
        expect(o.filters.tenant_id ?? o.payload?.tenant_id).toBe("t1");
      }
    });

    it("is owner-only and writes nothing for a non-owner", async () => {
      h.session = { tenantId: "t1", userId: "u2", role: "member" };
      arm();
      const res = await run();
      expect(location(res).searchParams.get("error")).toBe("owner_required");
      expect(h.connector.exchangeCodeForToken).not.toHaveBeenCalled();
      expect(db().ops).toHaveLength(0);
    });
  });

  describe("state and provider errors", () => {
    it("rejects a mismatched state", async () => {
      arm("OTHER");
      const res = await run();
      expect(location(res).searchParams.get("error")).toBe("invalid_state");
      expect(h.connector.exchangeCodeForToken).not.toHaveBeenCalled();
    });

    it("rejects a missing state cookie and missing code", async () => {
      expect(location(await run()).searchParams.get("error")).toBe("invalid_state");
      arm();
      expect(location(await run("state=STATE")).searchParams.get("error")).toBe("invalid_state");
      expect(db().ops).toHaveLength(0);
    });

    it("consumes the state cookie (single use), even on provider denial", async () => {
      arm();
      const res = await run("error=access_denied&state=STATE");
      expect(location(res).searchParams.get("error")).toBe("denied");
      expect(h.jar.has(cookie)).toBe(false);
      expect(h.connector.exchangeCodeForToken).not.toHaveBeenCalled();
    });

    it("writes nothing when the code exchange fails", async () => {
      h.connector.exchangeCodeForToken = vi.fn(async () => {
        throw new Error("boom");
      });
      arm();
      const res = await run();
      expect(location(res).searchParams.get("error")).toBe("connect_failed");
      expect(db().ops).toHaveLength(0);
    });

    it("writes nothing when the platform returns no ad account", async () => {
      h.connector.getAccounts = vi.fn(async () => []);
      arm();
      const res = await run();
      expect(location(res).searchParams.get("error")).toBe("no_ad_account");
      expect(db().ops).toHaveLength(0);
    });

    it("reports server_not_configured when the admin client is unavailable", async () => {
      h.adminAvailable = false;
      arm();
      const res = await run();
      expect(location(res).searchParams.get("error")).toBe("server_not_configured");
      expect(h.connector.exchangeCodeForToken).not.toHaveBeenCalled();
    });
  });
});
