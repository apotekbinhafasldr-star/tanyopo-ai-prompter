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

const GLOBAL_ROW = {
  capability: "CONNECT_ACCOUNT",
  enabled: true,
  status: "SUPPORTED",
  requires_oauth: true,
  requires_approval: false,
  api_version: "v21.0",
  notes: null,
  country_code: "",
};

describe("capability registry — UI gating based on capabilities", () => {
  it("maps snake_case DB columns to the CapabilityRow shape", async () => {
    const supabase = mockSupabase([GLOBAL_ROW]);

    const rows = await getCapabilities(supabase, "META");
    expect(rows).toEqual([
      {
        capability: "CONNECT_ACCOUNT",
        enabled: true,
        status: "SUPPORTED",
        requiresOauth: true,
        requiresApproval: false,
        apiVersion: "v21.0",
        notes: null,
        countryCode: "",
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

  it("resolves to the global row when no country is requested", async () => {
    const supabase = mockSupabase([GLOBAL_ROW]);
    const rows = await getCapabilities(supabase, "META");
    expect(rows[0].countryCode).toBe("");
    expect(rows[0].status).toBe("SUPPORTED");
  });

  it("prefers a region-specific override over the global row when one exists for the requested market", async () => {
    const regionRow = {
      ...GLOBAL_ROW,
      status: "REQUIRES_APPROVAL",
      enabled: false,
      country_code: "MY",
      notes: "Butuh approval khusus Malaysia",
    };
    const supabase = mockSupabase([GLOBAL_ROW, regionRow]);

    const rows = await getCapabilities(supabase, "META", "MY");
    expect(rows).toHaveLength(1);
    expect(rows[0].countryCode).toBe("MY");
    expect(rows[0].status).toBe("REQUIRES_APPROVAL");
  });

  it("falls back to the global row for a market with no region-specific override", async () => {
    const supabase = mockSupabase([GLOBAL_ROW]);
    const rows = await getCapabilities(supabase, "META", "SG");
    expect(rows[0].countryCode).toBe("");
    expect(rows[0].status).toBe("SUPPORTED");
  });

  it("isCapabilityEnabled is true only for a capability explicitly marked enabled", () => {
    const rows: CapabilityRow[] = [
      {
        capability: "CONNECT_ACCOUNT",
        enabled: true,
        status: "SUPPORTED",
        requiresOauth: true,
        requiresApproval: false,
        apiVersion: null,
        notes: null,
        countryCode: "",
      },
      {
        capability: "CREATE_AD",
        enabled: false,
        status: "NOT_CONFIGURED",
        requiresOauth: true,
        requiresApproval: true,
        apiVersion: null,
        notes: "belum disetujui",
        countryCode: "",
      },
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
