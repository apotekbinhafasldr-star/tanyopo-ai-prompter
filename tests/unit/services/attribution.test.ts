import { describe, expect, it, vi } from "vitest";
import { recordSingleTouchAttribution } from "@/services/attribution";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

function mockSupabase() {
  const deleteEq = vi.fn(async () => ({ data: null, error: null }));
  const insert = vi.fn(async () => ({ data: null, error: null }));
  const from = vi.fn(() => ({
    delete: () => ({ eq: deleteEq }),
    insert,
  }));
  return { from, deleteEq, insert } as unknown as SupabaseClient<Database> & {
    deleteEq: typeof deleteEq;
    insert: typeof insert;
    from: typeof from;
  };
}

describe("recordSingleTouchAttribution", () => {
  it("no-ops without touching the database when no campaign is known", async () => {
    const supabase = mockSupabase();

    await recordSingleTouchAttribution(supabase, {
      tenantId: "t1",
      conversionId: "c1",
      masterCampaignId: null,
      channelCampaignId: null,
      value: 100,
      model: "MANUAL",
    });

    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("deletes any existing attribution for the conversion before inserting the new one", async () => {
    const supabase = mockSupabase();

    await recordSingleTouchAttribution(supabase, {
      tenantId: "t1",
      conversionId: "c1",
      masterCampaignId: "camp-1",
      channelCampaignId: null,
      value: 50000,
      model: "UMKMPRO_VERIFIED",
    });

    expect(supabase.deleteEq).toHaveBeenCalledWith("conversion_id", "c1");
    expect(supabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: "t1",
        conversion_id: "c1",
        master_campaign_id: "camp-1",
        channel_campaign_id: null,
        attribution_model: "UMKMPRO_VERIFIED",
        weight: 100,
        attributed_value: 50000,
      }),
    );
  });

  it("writes an attribution when only a channel-level campaign is known", async () => {
    const supabase = mockSupabase();

    await recordSingleTouchAttribution(supabase, {
      tenantId: "t1",
      conversionId: "c2",
      masterCampaignId: null,
      channelCampaignId: "chan-1",
      value: null,
      model: "MANUAL",
    });

    expect(supabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({ channel_campaign_id: "chan-1", master_campaign_id: null }),
    );
  });
});
