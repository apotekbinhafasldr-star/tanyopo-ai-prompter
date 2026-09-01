import { describe, expect, it } from "vitest";
import { isAllowedToManageConnections } from "@/lib/connectors/authorize";
import type { TenantRole } from "@/types/database";

/**
 * Regression test for a real finding from this feature's security
 * review: connector connect/disconnect/verify writes go through the
 * service-role client (required for the zero-RLS
 * prompter_oauth_credentials table), which bypasses
 * prompter_connected_accounts' own "Owner kelola koneksi platform" RLS
 * policy. isAllowedToManageConnections() is what re-enforces that
 * owner-only rule at the application layer — every non-owner role must
 * be rejected.
 */
describe("isAllowedToManageConnections — Connection Center role gating", () => {
  it("allows the owner role", () => {
    expect(isAllowedToManageConnections("owner")).toBe(true);
  });

  it("rejects every non-owner tenant role", () => {
    const nonOwnerRoles: TenantRole[] = ["apoteker", "kasir", "admin_gudang", "hr", "marketing"];
    for (const role of nonOwnerRoles) {
      expect(isAllowedToManageConnections(role)).toBe(false);
    }
  });
});
