import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * Regression tests for the Connections page against the CURRENT production
 * schema, where the Track B columns (`selected_page_id`, `selected_page_name`)
 * are not applied yet, and for a failed connection read.
 *
 * Guarantees under test:
 *  - the base status read never names a Track B column;
 *  - a missing/unreadable Track B column degrades only the Page picker, never
 *    the connection status;
 *  - a failed base read is never rendered as "Belum Terhubung" or "Hubungkan".
 */

interface QueryResult {
  data: unknown;
  error: { code: string; message: string } | null;
}

const hoisted = vi.hoisted(() => ({
  role: "owner" as string,
  configured: true,
  list: { data: [], error: null } as QueryResult,
  pageRead: { data: null, error: null } as QueryResult,
  selects: [] as string[],
}));

vi.mock("@/services/session", () => ({
  requireSessionContext: vi.fn(async () => ({ tenantId: "t1", userId: "u1", role: hoisted.role })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => {
      if (table === "prompter_connected_accounts") {
        return {
          select: (columns: string) => {
            hoisted.selects.push(columns);
            if (columns === "selected_page_name") {
              return { eq: () => ({ eq: () => ({ maybeSingle: async () => hoisted.pageRead }) }) };
            }
            return { eq: async () => hoisted.list };
          },
        };
      }
      if (table === "prompter_brand_profiles") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  })),
}));

vi.mock("@/lib/connectors/get-connector", () => ({
  getConnector: vi.fn(() => ({ isConfigured: () => hoisted.configured })),
}));
vi.mock("@/lib/connectors/capability-registry", () => ({ getCapabilities: vi.fn(async () => []) }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: vi.fn(async () => false) }));

vi.mock("@/features/connections/disconnect-button", () => ({
  DisconnectButton: () => <button type="button">Putuskan</button>,
}));
vi.mock("@/features/connections/meta-page-picker", () => ({
  MetaPagePicker: ({ selectedPageName }: { selectedPageName: string | null }) => (
    <div data-testid="meta-page-picker">{selectedPageName ?? "belum dipilih"}</div>
  ),
}));

import ConnectionsPage from "@/app/(app)/connections/page";

const META_CONNECTED = {
  platform: "META",
  external_account_name: "Akun Iklan Toko",
  status: "CONNECTED",
  expires_at: null,
  last_refreshed_at: "2026-10-01T00:00:00.000Z",
};

const MISSING_COLUMN_ERROR = { code: "42703", message: "column selected_page_name does not exist" };

async function renderPage() {
  render(await ConnectionsPage({ searchParams: Promise.resolve({}) }));
}

describe("ConnectionsPage — schema without Track B columns and failed reads", () => {
  let consoleError: MockInstance;

  beforeEach(() => {
    hoisted.role = "owner";
    hoisted.configured = true;
    hoisted.list = { data: [], error: null };
    hoisted.pageRead = { data: null, error: null };
    hoisted.selects = [];
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    consoleError.mockRestore();
  });

  it("shows the real connection status from the base read when the Track B column does not exist", async () => {
    hoisted.list = { data: [META_CONNECTED], error: null };
    hoisted.pageRead = { data: null, error: MISSING_COLUMN_ERROR };

    await renderPage();

    // The base read must work against a schema that has no Track B column.
    expect(hoisted.selects[0]).not.toMatch(/selected_page/);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Terhubung")).toBeInTheDocument();
    expect(screen.getByText("Akun Iklan Toko", { exact: false })).toBeInTheDocument();
    // Only the Page picker degrades; it is replaced by an honest note.
    expect(screen.queryByTestId("meta-page-picker")).toBeNull();
    expect(screen.getByText(/Pemilihan Facebook Page belum tersedia/)).toBeInTheDocument();
  });

  it("shows the Page picker with the saved Page name when the Track B column is readable", async () => {
    hoisted.list = { data: [META_CONNECTED], error: null };
    hoisted.pageRead = { data: { selected_page_name: "Toko Berkah" }, error: null };

    await renderPage();

    expect(screen.getByTestId("meta-page-picker")).toHaveTextContent("Toko Berkah");
    expect(screen.queryByText(/Pemilihan Facebook Page belum tersedia/)).toBeNull();
  });

  it("distinguishes 'no Page chosen yet' (readable, null) from 'could not read'", async () => {
    hoisted.list = { data: [META_CONNECTED], error: null };
    hoisted.pageRead = { data: { selected_page_name: null }, error: null };

    await renderPage();

    expect(screen.getByTestId("meta-page-picker")).toHaveTextContent("belum dipilih");
  });

  it("does not run the Track B query for a non-owner", async () => {
    hoisted.role = "marketing";
    hoisted.list = { data: [META_CONNECTED], error: null };

    await renderPage();

    expect(hoisted.selects).not.toContain("selected_page_name");
    expect(screen.queryByTestId("meta-page-picker")).toBeNull();
  });

  it("does not run the Track B query when there is no Meta account", async () => {
    hoisted.list = { data: [], error: null };

    await renderPage();

    expect(hoisted.selects).not.toContain("selected_page_name");
  });

  it("never shows 'Belum Terhubung' or a Connect button when the connection read fails", async () => {
    hoisted.list = { data: null, error: { code: "42501", message: "permission denied for table x" } };

    await renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent(/tidak dapat dibaca/);
    expect(screen.getByRole("alert")).toHaveTextContent(/bukan berarti akun Anda belum terhubung/i);
    expect(screen.queryByText("Belum Terhubung")).toBeNull();
    expect(screen.queryByText("Terhubung")).toBeNull();
    expect(screen.queryByText("Hubungkan")).toBeNull();
    expect(screen.queryByText("Facebook & Instagram")).toBeNull();
    expect(hoisted.selects).not.toContain("selected_page_name");
    // The static, data-independent cards are unaffected.
    expect(screen.getByText("Website")).toBeInTheDocument();
  });

  it("logs only the error code, never row data or the error message", async () => {
    hoisted.list = { data: null, error: { code: "42501", message: "secret-looking-detail" } };

    await renderPage();

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("connections"), { code: "42501" });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret-looking-detail");
  });

  it("treats data: null with no error as a failed read, not as 'no accounts'", async () => {
    hoisted.list = { data: null, error: null };

    await renderPage();

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Belum Terhubung")).toBeNull();
  });

  it("still shows 'Belum Terhubung' when the read succeeds and there really are no accounts", async () => {
    hoisted.list = { data: [], error: null };

    await renderPage();

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getAllByText("Belum Terhubung")).toHaveLength(3);
    expect(screen.getAllByText("Hubungkan")).toHaveLength(3);
  });

  it("keeps 'Belum Dikonfigurasi' for unconfigured connectors on a successful read", async () => {
    hoisted.configured = false;
    hoisted.list = { data: [], error: null };

    await renderPage();

    expect(screen.getAllByText("Belum Dikonfigurasi")).toHaveLength(3);
    expect(screen.queryByText("Belum Terhubung")).toBeNull();
  });
});
