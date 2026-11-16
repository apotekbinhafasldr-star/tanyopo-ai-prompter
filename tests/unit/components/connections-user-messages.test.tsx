import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/services/session", () => ({
  requireSessionContext: vi.fn(async () => ({ tenantId: "t1", userId: "u1", role: "owner" })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) =>
      table === "prompter_connected_accounts"
        ? { select: () => ({ eq: async () => ({ data: [], error: null }) }) }
        : { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) },
  })),
}));
vi.mock("@/lib/connectors/get-connector", () => ({ getConnector: vi.fn(() => ({ isConfigured: () => false })) }));
vi.mock("@/lib/connectors/capability-registry", () => ({ getCapabilities: vi.fn(async () => []) }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: vi.fn(async () => false) }));
vi.mock("@/features/connections/disconnect-button", () => ({ DisconnectButton: () => null }));
vi.mock("@/features/connections/meta-page-picker", () => ({ MetaPagePicker: () => null }));
vi.mock("@/features/connections/meta-ad-account-section", () => ({ MetaAdAccountSection: () => null }));

import ConnectionsPage from "@/app/(app)/connections/page";

afterEach(cleanup);

const ENV_NAME = /\b[A-Z][A-Z0-9]*(_[A-Z0-9]+)+\b/;

async function renderWith(params: { error?: string; connected?: string }) {
  render(await ConnectionsPage({ searchParams: Promise.resolve(params) }));
  return document.body.textContent ?? "";
}

describe("Connections page user-facing messages", () => {
  it.each([
    "not_configured",
    "encryption_not_configured",
    "server_not_configured",
    "save_failed",
    "provider_pending",
  ])("error=%s is announced as an alert and leaks no env variable names", async (code) => {
    const text = await renderWith({ error: code });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(text).not.toMatch(ENV_NAME);
  });

  it("not-yet-configured platform cards leak no env variable names", async () => {
    const text = await renderWith({});
    expect(text).not.toMatch(ENV_NAME);
  });

  it("an unknown ?connected= value is never echoed back into the page", async () => {
    const text = await renderWith({ connected: "<b>penipuan</b>" });
    expect(text).not.toContain("penipuan");
    expect(screen.getByRole("status")).toHaveTextContent("Berhasil terhubung.");
  });
});
