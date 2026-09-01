import { describe, expect, it } from "vitest";
import { isCapabilityEnabled, getCapabilities, type CapabilityRow } from "@/lib/connectors/capability-registry";

function mockSupabase(rows: Array<Record<string, unknown>>) {
  return {
    from: () => ({
      select: () => ({
        eq: async () => ({ data: rows, error: null }),
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("capability registry — UI gating based on capabilities", () => {
  it("maps snake_case DB columns to the CapabilityRow shape", async () => {
    const supabase = mockSupabase([
      {
        capability: "CONNECT_ACCOUNT",
        enabled: true,
        requires_oauth: true,
        requires_approval: false,
        api_version: "v21.0",
        notes: null,
      },
    ]);

    const rows = await getCapabilities(supabase, "META");
    expect(rows).toEqual([
      {
        capability: "CONNECT_ACCOUNT",
        enabled: true,
        requiresOauth: true,
        requiresApproval: false,
        apiVersion: "v21.0",
        notes: null,
      },
    ]);
  });

  it("returns an empty list (never throws) on a query error", async () => {
    const supabase = {
      from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { message: "boom" } }) }) }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    expect(await getCapabilities(supabase, "TIKTOK")).toEqual([]);
  });

  it("isCapabilityEnabled is true only for a capability explicitly marked enabled", () => {
    const rows: CapabilityRow[] = [
      { capability: "CONNECT_ACCOUNT", enabled: true, requiresOauth: true, requiresApproval: false, apiVersion: null, notes: null },
      { capability: "CREATE_AD", enabled: false, requiresOauth: true, requiresApproval: true, apiVersion: null, notes: "belum disetujui" },
    ];

    expect(isCapabilityEnabled(rows, "CONNECT_ACCOUNT")).toBe(true);
    expect(isCapabilityEnabled(rows, "CREATE_AD")).toBe(false);
    // A capability with no row at all (never seeded) must also read as disabled.
    expect(isCapabilityEnabled(rows, "PUBLISH_CONTENT")).toBe(false);
  });

  it("never hard-codes a platform as available — an empty registry disables everything", () => {
    expect(isCapabilityEnabled([], "CONNECT_ACCOUNT")).toBe(false);
  });
});
