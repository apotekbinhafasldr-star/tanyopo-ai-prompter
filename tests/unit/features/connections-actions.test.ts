import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { requireSessionContextMock } = vi.hoisted(() => ({
  requireSessionContextMock: vi.fn(async () => ({ tenantId: "t1", userId: "u1", role: "owner" })),
}));
vi.mock("@/services/session", () => ({ requireSessionContext: requireSessionContextMock }));

const { decryptTokenMock } = vi.hoisted(() => ({
  decryptTokenMock: vi.fn(() => "super-secret-access-token"),
}));
vi.mock("@/lib/crypto/token-cipher", () => ({ decryptToken: decryptTokenMock }));

// A real class (not a plain vi.fn()) so lib/connectors/get-connector.ts's
// own module-level `new MetaConnector()` (used by disconnectAction, also
// imported from this same actions file) keeps working under this mock —
// a bare arrow-function mock isn't constructable and would throw there.
const { getPagesMock } = vi.hoisted(() => ({ getPagesMock: vi.fn() }));
vi.mock("@/lib/connectors/meta-connector", () => ({
  MetaConnector: class {
    getPages(accessToken: string) {
      return getPagesMock(accessToken);
    }
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeSelectChain(result: any) {
  const maybeSingle = vi.fn(async () => result);
  const eq2 = vi.fn(() => ({ maybeSingle }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const select = vi.fn(() => ({ eq: eq1 }));
  return { select, eq1, eq2, maybeSingle };
}

// prompter_oauth_credentials is read through the admin client (RLS bypassed), so the
// query itself must carry BOTH filters: connected_account_id AND tenant_id. This fake
// applies the filters it receives to one stored row, like the real table would, so a
// missing/incorrect tenant filter returns the row (test fails) instead of passing silently.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeCredentialsChain(
  row: { connected_account_id: string; tenant_id: string; encrypted_access_token: string } | null,
) {
  const filters: Record<string, unknown> = {};
  const maybeSingle = vi.fn(async () => {
    const matches =
      row !== null && Object.entries(filters).every(([col, val]) => (row as Record<string, unknown>)[col] === val);
    return { data: matches ? { encrypted_access_token: row!.encrypted_access_token } : null, error: null };
  });
  const eq2 = vi.fn((col: string, val: unknown) => {
    filters[col] = val;
    return { maybeSingle };
  });
  const eq1 = vi.fn((col: string, val: unknown) => {
    filters[col] = val;
    return { eq: eq2 };
  });
  const select = vi.fn(() => ({ eq: eq1 }));
  return { select, eq1, eq2, maybeSingle, filters };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeUpdateChain(result: any) {
  const eq2 = vi.fn(async () => result);
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const update = vi.fn(() => ({ eq: eq1 }));
  return { update, eq1, eq2 };
}

function makeInsertChain() {
  const insert = vi.fn(async () => ({ error: null }));
  return { insert };
}

interface Harness {
  connectedAccountSelect: ReturnType<typeof makeSelectChain>;
  connectedAccountUpdate: ReturnType<typeof makeUpdateChain>;
  credentialsSelect: ReturnType<typeof makeCredentialsChain>;
  auditInsert: ReturnType<typeof makeInsertChain>;
  regularFrom: ReturnType<typeof vi.fn>;
  adminFrom: ReturnType<typeof vi.fn>;
}

function buildHarness(overrides: {
  connectedAccount?: { data: unknown; error: unknown };
  credentialsRow?: { connected_account_id: string; tenant_id: string; encrypted_access_token: string } | null;
} = {}): Harness {
  const connectedAccountSelect = makeSelectChain(
    overrides.connectedAccount ?? { data: { id: "acct_1", status: "CONNECTED" }, error: null },
  );
  const connectedAccountUpdate = makeUpdateChain({ error: null });
  const credentialsSelect = makeCredentialsChain(
    overrides.credentialsRow === undefined
      ? { connected_account_id: "acct_1", tenant_id: "t1", encrypted_access_token: "cipher-text" }
      : overrides.credentialsRow,
  );
  const auditInsert = makeInsertChain();

  const regularFrom = vi.fn((table: string) => {
    if (table === "prompter_connected_accounts") {
      return {
        select: connectedAccountSelect.select,
        update: connectedAccountUpdate.update,
        delete: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
      };
    }
    if (table === "prompter_audit_logs") {
      return { insert: auditInsert.insert };
    }
    throw new Error(`Unexpected table on regular client: ${table}`);
  });

  const adminFrom = vi.fn((table: string) => {
    if (table === "prompter_oauth_credentials") {
      return { select: credentialsSelect.select };
    }
    throw new Error(`Unexpected table on admin client: ${table}`);
  });

  return { connectedAccountSelect, connectedAccountUpdate, credentialsSelect, auditInsert, regularFrom, adminFrom };
}

let harness: Harness;

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ from: harness.regularFrom })) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({ from: harness.adminFrom })) }));

import { disconnectAction, listMetaPagesAction, selectMetaPageAction } from "@/features/connections/actions";

describe("listMetaPagesAction / selectMetaPageAction — Track B Meta Page Picker", () => {
  beforeEach(() => {
    requireSessionContextMock.mockReset();
    requireSessionContextMock.mockResolvedValue({ tenantId: "t1", userId: "u1", role: "owner" });
    decryptTokenMock.mockClear();
    getPagesMock.mockReset();
    harness = buildHarness();
  });

  describe("authorization", () => {
    it("listMetaPagesAction rejects a non-owner without touching the database or Meta", async () => {
      requireSessionContextMock.mockResolvedValue({ tenantId: "t1", userId: "u1", role: "marketing" });

      const result = await listMetaPagesAction();

      expect(result.error).toMatch(/Owner/);
      expect(harness.regularFrom).not.toHaveBeenCalled();
      expect(getPagesMock).not.toHaveBeenCalled();
    });

    it("selectMetaPageAction rejects a non-owner without persisting anything", async () => {
      requireSessionContextMock.mockResolvedValue({ tenantId: "t1", userId: "u1", role: "marketing" });

      const result = await selectMetaPageAction("page_1");

      expect(result.error).toMatch(/Owner/);
      expect(harness.connectedAccountUpdate.update).not.toHaveBeenCalled();
      expect(getPagesMock).not.toHaveBeenCalled();
    });
  });

  describe("tenant isolation", () => {
    it("scopes the connected-account lookup to the caller's own tenant and platform META", async () => {
      getPagesMock.mockResolvedValue([{ id: "page_1", name: "Toko A" }]);

      await listMetaPagesAction();

      expect(harness.connectedAccountSelect.eq1).toHaveBeenCalledWith("tenant_id", "t1");
      expect(harness.connectedAccountSelect.eq2).toHaveBeenCalledWith("platform", "META");
    });

    it("scopes the credential lookup to the connected account just resolved for this tenant", async () => {
      getPagesMock.mockResolvedValue([]);

      await listMetaPagesAction();

      expect(harness.credentialsSelect.eq1).toHaveBeenCalledWith("connected_account_id", "acct_1");
    });

    it("also pins the credential lookup to the session tenant (explicit tenant_id, admin client bypasses RLS)", async () => {
      getPagesMock.mockResolvedValue([]);

      await listMetaPagesAction();

      expect(harness.credentialsSelect.eq2).toHaveBeenCalledWith("tenant_id", "t1");
      expect(harness.credentialsSelect.filters).toEqual({ connected_account_id: "acct_1", tenant_id: "t1" });
    });

    it("listMetaPagesAction: a credential row that belongs to ANOTHER tenant is never returned or decrypted", async () => {
      harness = buildHarness({
        credentialsRow: { connected_account_id: "acct_1", tenant_id: "t2", encrypted_access_token: "other-tenant-cipher" },
      });

      const result = await listMetaPagesAction();

      expect(result.error).toMatch(/Kredensial koneksi tidak ditemukan/);
      expect(decryptTokenMock).not.toHaveBeenCalled();
      expect(getPagesMock).not.toHaveBeenCalled();
    });

    it("listMetaPagesAction: fails closed when the session carries no valid tenant id", async () => {
      requireSessionContextMock.mockResolvedValue({ tenantId: "", userId: "u1", role: "owner" });

      const result = await listMetaPagesAction();

      expect(result.error).toMatch(/Kredensial koneksi tidak ditemukan/);
      expect(decryptTokenMock).not.toHaveBeenCalled();
      expect(getPagesMock).not.toHaveBeenCalled();
    });

    it("disconnectAction: reads the credential with connected_account_id AND the session tenant, then decrypts", async () => {
      await disconnectAction("META");

      expect(harness.credentialsSelect.filters).toEqual({ connected_account_id: "acct_1", tenant_id: "t1" });
      expect(decryptTokenMock).toHaveBeenCalledTimes(1);
    });

    it("disconnectAction: another tenant's credential row is never decrypted or sent to the platform", async () => {
      harness = buildHarness({
        credentialsRow: { connected_account_id: "acct_1", tenant_id: "t2", encrypted_access_token: "other-tenant-cipher" },
      });

      const result = await disconnectAction("META");

      expect(result.error).toBeNull();
      expect(decryptTokenMock).not.toHaveBeenCalled();
    });

    it("scopes the persisted update to the caller's own tenant and platform META, never a client-supplied tenant", async () => {
      getPagesMock.mockResolvedValue([{ id: "page_1", name: "Toko A" }]);

      await selectMetaPageAction("page_1");

      expect(harness.connectedAccountUpdate.eq1).toHaveBeenCalledWith("tenant_id", "t1");
      expect(harness.connectedAccountUpdate.eq2).toHaveBeenCalledWith("platform", "META");
    });
  });

  describe("invalid Page ID", () => {
    it("rejects a pageId that isn't in the live Meta result, and never persists it", async () => {
      getPagesMock.mockResolvedValue([{ id: "page_1", name: "Toko A" }]);

      const result = await selectMetaPageAction("page_999");

      expect(result.error).toMatch(/tidak ditemukan/i);
      expect(harness.connectedAccountUpdate.update).not.toHaveBeenCalled();
    });

    it("rejects an empty/blank pageId before ever calling Meta", async () => {
      const result = await selectMetaPageAction("");

      expect(result.error).toBeTruthy();
      expect(getPagesMock).not.toHaveBeenCalled();
    });
  });

  describe("valid Page selection", () => {
    it("persists exactly the id/name pair Meta returned, and logs an audit entry", async () => {
      getPagesMock.mockResolvedValue([
        { id: "page_1", name: "Toko A" },
        { id: "page_2", name: "Toko B" },
      ]);

      const result = await selectMetaPageAction("page_2");

      expect(result.error).toBeNull();
      expect(harness.connectedAccountUpdate.update).toHaveBeenCalledWith({
        selected_page_id: "page_2",
        selected_page_name: "Toko B",
      });
      expect(harness.auditInsert.insert).toHaveBeenCalledWith(
        expect.objectContaining({ action: "connection.meta_page_selected", tenant_id: "t1" }),
      );
    });

    it("re-fetches from Meta at selection time rather than trusting any client-cached list", async () => {
      getPagesMock.mockResolvedValue([{ id: "page_1", name: "Toko A" }]);

      await selectMetaPageAction("page_1");

      // The only source of truth for validity is this live call — called
      // once per action invocation, always freshly, never skipped.
      expect(getPagesMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("no token/secret exposure", () => {
    it("listMetaPagesAction never returns the decrypted access token or any credential field", async () => {
      getPagesMock.mockResolvedValue([{ id: "page_1", name: "Toko A" }]);

      const result = await listMetaPagesAction();

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("super-secret-access-token");
      expect(serialized).not.toContain("cipher-text");
      expect(result.pages).toEqual([{ id: "page_1", name: "Toko A" }]);
    });

    it("a Meta API failure's error message never contains the access token", async () => {
      getPagesMock.mockRejectedValue(new Error("Graph API error (HTTP 400)."));

      const result = await listMetaPagesAction();

      expect(result.error).not.toContain("super-secret-access-token");
    });
  });

  describe("backward compatibility", () => {
    it("a tenant with no Meta connection at all gets the same honest NOT_CONNECTED-style error as before Track B", async () => {
      harness = buildHarness({ connectedAccount: { data: null, error: null } });

      const result = await listMetaPagesAction();

      expect(result.error).toMatch(/belum terhubung/i);
      expect(getPagesMock).not.toHaveBeenCalled();
    });

    it("a Meta connection with no credentials row yet fails closed, not with a crash", async () => {
      harness = buildHarness({ credentialsRow: null });

      const result = await listMetaPagesAction();

      expect(result.error).toBeTruthy();
      expect(getPagesMock).not.toHaveBeenCalled();
    });
  });
});
