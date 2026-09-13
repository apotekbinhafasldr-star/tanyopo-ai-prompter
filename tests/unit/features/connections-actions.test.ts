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

// prompter_oauth_credentials is only ever filtered by one column
// (connected_account_id) before .maybeSingle() — a distinct shape from
// the two-.eq() chain above.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeSingleEqSelectChain(result: any) {
  const maybeSingle = vi.fn(async () => result);
  const eq1 = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq: eq1 }));
  return { select, eq1, maybeSingle };
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
  credentialsSelect: ReturnType<typeof makeSingleEqSelectChain>;
  auditInsert: ReturnType<typeof makeInsertChain>;
  regularFrom: ReturnType<typeof vi.fn>;
  adminFrom: ReturnType<typeof vi.fn>;
}

function buildHarness(overrides: {
  connectedAccount?: { data: unknown; error: unknown };
  credentials?: { data: unknown; error: unknown };
} = {}): Harness {
  const connectedAccountSelect = makeSelectChain(
    overrides.connectedAccount ?? { data: { id: "acct_1", status: "CONNECTED" }, error: null },
  );
  const connectedAccountUpdate = makeUpdateChain({ error: null });
  const credentialsSelect = makeSingleEqSelectChain(
    overrides.credentials ?? { data: { encrypted_access_token: "cipher-text" }, error: null },
  );
  const auditInsert = makeInsertChain();

  const regularFrom = vi.fn((table: string) => {
    if (table === "prompter_connected_accounts") {
      return { select: connectedAccountSelect.select, update: connectedAccountUpdate.update };
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

import { listMetaPagesAction, selectMetaPageAction } from "@/features/connections/actions";

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
      harness = buildHarness({ credentials: { data: null, error: null } });

      const result = await listMetaPagesAction();

      expect(result.error).toBeTruthy();
      expect(getPagesMock).not.toHaveBeenCalled();
    });
  });
});
