import { describe, expect, it, vi } from "vitest";
import {
  runMetaReadinessCheck,
  type MetaReadinessDeps,
  type ReadinessConnectionRow,
} from "@/features/connections/meta-readiness-core";
import { ConnectorApiError, ConnectorConfigError } from "@/lib/connectors/types";
import type { MetaReadinessLookup } from "@/lib/connectors/meta-connector";
import type { MetaAdAccountSnapshot } from "@/lib/connectors/meta-readiness";

const NOW = new Date("2026-10-27T10:00:00.000Z");
const FUTURE = "2026-12-01T00:00:00.000Z";
const PAST = "2026-10-01T00:00:00.000Z";

const GOOD_SNAPSHOT: MetaAdAccountSnapshot = {
  accountStatus: 1,
  currency: "IDR",
  isPrepayAccount: false,
  hasFundingSource: true,
  minDailyBudgetRaw: 25000,
};

const GOOD_LOOKUP: MetaReadinessLookup = { kind: "OK", snapshot: GOOD_SNAPSHOT };

interface TenantFixture {
  connection: ReadinessConnectionRow;
  encryptedToken: string | null;
}

/**
 * In-memory stand-in for the two tenants' rows. The fakes only return what the
 * REQUESTED tenant owns, exactly like the real tenant-scoped queries — so a
 * regression that passed the wrong tenant id would surface as the wrong token.
 */
function buildDeps(
  tenants: Record<string, TenantFixture | undefined>,
  overrides: Partial<MetaReadinessDeps> = {},
) {
  const loadConnection = vi.fn(async (tenantId: string) => ({
    ok: true as const,
    connection: tenants[tenantId]?.connection ?? null,
  }));
  const loadEncryptedToken = vi.fn(async (tenantId: string, connectedAccountId: string) => {
    const fixture = tenants[tenantId];
    const owns = fixture && fixture.connection.id === connectedAccountId;
    return { ok: true as const, encrypted: owns ? fixture.encryptedToken : null };
  });
  const decrypt = vi.fn((blob: string) => `plain(${blob})`);
  const getAccountReadinessSnapshot = vi.fn(async (): Promise<MetaReadinessLookup> => GOOD_LOOKUP);
  const logFailure = vi.fn();

  const deps: MetaReadinessDeps = {
    loadConnection,
    loadEncryptedToken,
    decrypt,
    connector: { isConfigured: () => true, getAccountReadinessSnapshot },
    now: () => NOW,
    logFailure,
    ...overrides,
  };
  return { deps, loadConnection, loadEncryptedToken, decrypt, getAccountReadinessSnapshot, logFailure };
}

function connected(overrides: Partial<ReadinessConnectionRow> = {}): ReadinessConnectionRow {
  return { id: "conn-A", status: "CONNECTED", external_account_id: "act_111", expires_at: FUTURE, ...overrides };
}

const OWNER_A = { tenantId: "tenant-A", role: "owner" };

describe("runMetaReadinessCheck — access", () => {
  it.each(["marketing", "viewer", "admin", ""])("refuses role %j and touches nothing", async (role) => {
    const h = buildDeps({ "tenant-A": { connection: connected(), encryptedToken: "cipher-A" } });

    const response = await runMetaReadinessCheck({ tenantId: "tenant-A", role }, h.deps);

    expect(response.result).toBeNull();
    expect(response.error).toContain("Hanya Owner");
    expect(h.loadConnection).not.toHaveBeenCalled();
    expect(h.loadEncryptedToken).not.toHaveBeenCalled();
    expect(h.getAccountReadinessSnapshot).not.toHaveBeenCalled();
  });

  it("is UNKNOWN (NOT_CONFIGURED) without calling anything when the connector is not configured", async () => {
    const h = buildDeps(
      { "tenant-A": { connection: connected(), encryptedToken: "cipher-A" } },
      { connector: { isConfigured: () => false, getAccountReadinessSnapshot: vi.fn() } },
    );

    const response = await runMetaReadinessCheck(OWNER_A, h.deps);

    expect(response.result?.state).toBe("UNKNOWN");
    expect(response.result?.unavailableReason).toBe("NOT_CONFIGURED");
    expect(h.loadConnection).not.toHaveBeenCalled();
  });
});

describe("runMetaReadinessCheck — tenant isolation", () => {
  const tenants = {
    "tenant-A": { connection: connected({ id: "conn-A", external_account_id: "act_111" }), encryptedToken: "cipher-A" },
    "tenant-B": { connection: connected({ id: "conn-B", external_account_id: "act_222" }), encryptedToken: "cipher-B" },
  };

  it("reads only the session tenant's connection and uses only that tenant's token and ad account", async () => {
    const h = buildDeps(tenants);

    const response = await runMetaReadinessCheck(OWNER_A, h.deps);

    expect(response.result?.state).toBe("READY");
    expect(h.loadConnection).toHaveBeenCalledTimes(1);
    expect(h.loadConnection).toHaveBeenCalledWith("tenant-A");
    expect(h.loadEncryptedToken).toHaveBeenCalledWith("tenant-A", "conn-A");
    expect(h.decrypt).toHaveBeenCalledWith("cipher-A");
    expect(h.getAccountReadinessSnapshot).toHaveBeenCalledWith("plain(cipher-A)", "act_111");
    expect(JSON.stringify(h.getAccountReadinessSnapshot.mock.calls)).not.toContain("cipher-B");
    expect(JSON.stringify(h.getAccountReadinessSnapshot.mock.calls)).not.toContain("act_222");
  });

  it("a tenant with no Meta connection is NOT_CONNECTED and never reaches Meta, even though another tenant is connected", async () => {
    const h = buildDeps({ "tenant-B": tenants["tenant-B"] });

    const response = await runMetaReadinessCheck(OWNER_A, h.deps);

    expect(response.result?.unavailableReason).toBe("NOT_CONNECTED");
    expect(response.result?.state).toBe("UNKNOWN");
    expect(h.loadEncryptedToken).not.toHaveBeenCalled();
    expect(h.getAccountReadinessSnapshot).not.toHaveBeenCalled();
  });

  it("asks for the credentials of the connection id, scoped by tenant: another tenant's connection id yields nothing", async () => {
    // Defence in depth: even if a connection id from tenant B were passed with tenant A,
    // the tenant-scoped credential query returns no row, so the check cannot use B's token.
    const h = buildDeps(tenants);
    const lookup = await h.deps.loadEncryptedToken("tenant-A", "conn-B");
    expect(lookup).toEqual({ ok: true, encrypted: null });
  });
});

describe("runMetaReadinessCheck — connection state, expired and missing credentials", () => {
  it.each(["ACTION_REQUIRED", "EXPIRED", "NOT_CONNECTED"])(
    "status %s is NOT_CONNECTED and never calls Meta",
    async (status) => {
      const h = buildDeps({ "tenant-A": { connection: connected({ status }), encryptedToken: "cipher-A" } });
      const response = await runMetaReadinessCheck(OWNER_A, h.deps);
      expect(response.result?.unavailableReason).toBe("NOT_CONNECTED");
      expect(h.getAccountReadinessSnapshot).not.toHaveBeenCalled();
    },
  );

  it("an expired token is TOKEN_EXPIRED without decrypting or calling Meta", async () => {
    const h = buildDeps({ "tenant-A": { connection: connected({ expires_at: PAST }), encryptedToken: "cipher-A" } });

    const response = await runMetaReadinessCheck(OWNER_A, h.deps);

    expect(response.result?.state).toBe("UNKNOWN");
    expect(response.result?.unavailableReason).toBe("TOKEN_EXPIRED");
    expect(h.decrypt).not.toHaveBeenCalled();
    expect(h.getAccountReadinessSnapshot).not.toHaveBeenCalled();
  });

  it("an unparseable expiry is treated as expired (fail closed)", async () => {
    const h = buildDeps({ "tenant-A": { connection: connected({ expires_at: "not-a-date" }), encryptedToken: "cipher-A" } });
    const response = await runMetaReadinessCheck(OWNER_A, h.deps);
    expect(response.result?.unavailableReason).toBe("TOKEN_EXPIRED");
  });

  it("a connection without a stored ad account is NO_AD_ACCOUNT", async () => {
    const h = buildDeps({ "tenant-A": { connection: connected({ external_account_id: null }), encryptedToken: "cipher-A" } });
    const response = await runMetaReadinessCheck(OWNER_A, h.deps);
    expect(response.result?.unavailableReason).toBe("NO_AD_ACCOUNT");
    expect(h.getAccountReadinessSnapshot).not.toHaveBeenCalled();
  });

  it("missing stored credentials are CREDENTIALS_UNAVAILABLE", async () => {
    const h = buildDeps({ "tenant-A": { connection: connected(), encryptedToken: null } });
    const response = await runMetaReadinessCheck(OWNER_A, h.deps);
    expect(response.result?.unavailableReason).toBe("CREDENTIALS_UNAVAILABLE");
    expect(h.getAccountReadinessSnapshot).not.toHaveBeenCalled();
  });

  it("a decryption failure is CREDENTIALS_UNAVAILABLE and logs only the stage", async () => {
    const h = buildDeps(
      { "tenant-A": { connection: connected(), encryptedToken: "cipher-A" } },
      {
        decrypt: () => {
          throw new Error("bad key material: super-secret-key");
        },
      },
    );

    const response = await runMetaReadinessCheck(OWNER_A, h.deps);

    expect(response.result?.unavailableReason).toBe("CREDENTIALS_UNAVAILABLE");
    expect(h.logFailure).toHaveBeenCalledTimes(1);
    expect(h.getAccountReadinessSnapshot).not.toHaveBeenCalled();
    expect(JSON.stringify(response)).not.toContain("super-secret-key");
  });

  it("a database read failure is an error, never a result (so never READY)", async () => {
    const h = buildDeps({}, { loadConnection: async () => ({ ok: false }) });
    const response = await runMetaReadinessCheck(OWNER_A, h.deps);
    expect(response.result).toBeNull();
    expect(response.error).toContain("tidak dapat dibaca");
    expect(h.logFailure).toHaveBeenCalledWith("load_connection");
  });

  it("a credentials read failure is an error, never a result", async () => {
    const h = buildDeps(
      { "tenant-A": { connection: connected(), encryptedToken: "cipher-A" } },
      { loadEncryptedToken: async () => ({ ok: false }) },
    );
    const response = await runMetaReadinessCheck(OWNER_A, h.deps);
    expect(response.result).toBeNull();
    expect(h.getAccountReadinessSnapshot).not.toHaveBeenCalled();
  });
});

describe("runMetaReadinessCheck — Meta outcomes", () => {
  const fixture = { "tenant-A": { connection: connected(), encryptedToken: "cipher-A" } };

  it("returns READY only for a fully positive snapshot", async () => {
    const h = buildDeps(fixture);
    const response = await runMetaReadinessCheck(OWNER_A, h.deps);
    expect(response.error).toBeNull();
    expect(response.result?.state).toBe("READY");
    expect(response.result?.minDailyBudgetRaw).toBe(25000);
  });

  it("returns UNKNOWN, not READY, when the payment method is not detected", async () => {
    const h = buildDeps(fixture, {
      connector: {
        isConfigured: () => true,
        getAccountReadinessSnapshot: async () => ({
          kind: "OK",
          snapshot: { ...GOOD_SNAPSHOT, hasFundingSource: null },
        }),
      },
    });
    const response = await runMetaReadinessCheck(OWNER_A, h.deps);
    expect(response.result?.state).toBe("UNKNOWN");
  });

  it("returns NOT_READY for a non-IDR account", async () => {
    const h = buildDeps(fixture, {
      connector: {
        isConfigured: () => true,
        getAccountReadinessSnapshot: async () => ({
          kind: "OK",
          snapshot: { ...GOOD_SNAPSHOT, currency: "USD" },
        }),
      },
    });
    const response = await runMetaReadinessCheck(OWNER_A, h.deps);
    expect(response.result?.state).toBe("NOT_READY");
  });

  it.each([
    ["MULTIPLE", "MULTIPLE_AD_ACCOUNTS"],
    ["NONE", "NO_AD_ACCOUNT"],
    ["MISMATCH", "AD_ACCOUNT_MISMATCH"],
  ] as const)("lookup %s fails safe as %s with no checks evaluated", async (kind, reason) => {
    const h = buildDeps(fixture, {
      connector: { isConfigured: () => true, getAccountReadinessSnapshot: async () => ({ kind }) },
    });
    const response = await runMetaReadinessCheck(OWNER_A, h.deps);
    expect(response.result?.state).toBe("UNKNOWN");
    expect(response.result?.unavailableReason).toBe(reason);
    expect(response.result?.checks).toEqual([]);
  });

  it.each([
    [new ConnectorApiError("META", "Invalid OAuth access token plain(cipher-A)", { status: 401, code: 190 }), "TOKEN_EXPIRED"],
    [new ConnectorApiError("META", "Permissions error", { status: 403, code: 200 }), "PERMISSION_MISSING"],
    [new ConnectorApiError("META", "Too many calls", { status: 400, code: 17 }), "RATE_LIMITED"],
    [new ConnectorApiError("META", "Unsupported field", { status: 400, code: 100 }), "FIELD_UNAVAILABLE"],
    [new ConnectorApiError("META", "Meta Graph API tidak merespons tepat waktu.", {}), "PROVIDER_ERROR"],
    [new ConnectorApiError("META", "boom", { status: 500 }), "PROVIDER_ERROR"],
    [new ConnectorConfigError("META", "belum dikonfigurasi"), "NOT_CONFIGURED"],
    [new Error("socket hang up"), "PROVIDER_ERROR"],
  ] as const)("provider failure %# maps to %s and is never READY", async (failure, reason) => {
    const h = buildDeps(fixture, {
      connector: {
        isConfigured: () => true,
        getAccountReadinessSnapshot: async () => {
          throw failure;
        },
      },
    });

    const response = await runMetaReadinessCheck(OWNER_A, h.deps);

    expect(response.error).toBeNull();
    expect(response.result?.state).toBe("UNKNOWN");
    expect(response.result?.unavailableReason).toBe(reason);
    expect(h.logFailure).toHaveBeenCalledTimes(1);
  });
});

describe("runMetaReadinessCheck — nothing sensitive leaves the function", () => {
  it("the result contains no token, ad account id, funding id or provider text", async () => {
    const h = buildDeps(
      { "tenant-A": { connection: connected({ external_account_id: "act_111" }), encryptedToken: "cipher-A" } },
      {
        connector: {
          isConfigured: () => true,
          getAccountReadinessSnapshot: async () => {
            throw new ConnectorApiError("META", "Invalid OAuth access token plain(cipher-A) for act_111 fs_secret", {
              status: 401,
              code: 190,
            });
          },
        },
      },
    );

    const response = await runMetaReadinessCheck(OWNER_A, h.deps);
    const serialised = JSON.stringify(response);

    for (const secret of ["plain(cipher-A)", "cipher-A", "act_111", "fs_secret", "Invalid OAuth"]) {
      expect(serialised).not.toContain(secret);
    }
  });

  it("the success result contains no ad account id either", async () => {
    const h = buildDeps({ "tenant-A": { connection: connected({ external_account_id: "act_111" }), encryptedToken: "cipher-A" } });
    const response = await runMetaReadinessCheck(OWNER_A, h.deps);
    const serialised = JSON.stringify(response);
    expect(serialised).not.toContain("act_111");
    expect(serialised).not.toContain("cipher-A");
  });

  it("logFailure is only ever given a stage name and the thrown value, never the token", async () => {
    const h = buildDeps(
      { "tenant-A": { connection: connected(), encryptedToken: "cipher-A" } },
      {
        connector: {
          isConfigured: () => true,
          getAccountReadinessSnapshot: async () => {
            throw new ConnectorApiError("META", "x", { status: 500 });
          },
        },
      },
    );

    await runMetaReadinessCheck(OWNER_A, h.deps);

    const [stage, err] = h.logFailure.mock.calls[0];
    expect(stage).toBe("graph_lookup");
    expect(err).toBeInstanceOf(ConnectorApiError);
    expect(JSON.stringify(h.logFailure.mock.calls)).not.toContain("plain(cipher-A)");
  });
});
