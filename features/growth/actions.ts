"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSessionContext } from "@/services/session";
import { growthGoalSchema, followerSnapshotSchema } from "@/schemas/growth";
import type { GrowthPlatform } from "@/types/database";

export interface GrowthActionState {
  error: string | null;
}

function requireWriteAccess(role: string): string | null {
  if (role !== "owner" && role !== "marketing") {
    return "Hanya Owner/Marketing yang dapat mengubah data Growth.";
  }
  return null;
}

export async function setGrowthGoalAction(
  _prevState: GrowthActionState,
  formData: FormData,
): Promise<GrowthActionState> {
  const parsed = growthGoalSchema.safeParse({
    platform: formData.get("platform"),
    targetFollowers: formData.get("targetFollowers"),
    targetDate: formData.get("targetDate"),
    notes: formData.get("notes"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data tidak valid" };
  }

  const session = await requireSessionContext();
  const permissionError = requireWriteAccess(session.role);
  if (permissionError) return { error: permissionError };

  const supabase = await createClient();

  const { error } = await supabase.from("prompter_growth_goals").upsert(
    {
      tenant_id: session.tenantId,
      platform: parsed.data.platform as GrowthPlatform,
      target_followers: parsed.data.targetFollowers,
      target_date: parsed.data.targetDate || null,
      notes: parsed.data.notes || null,
    },
    { onConflict: "tenant_id,platform" },
  );

  if (error) {
    return { error: "Gagal menyimpan target growth. Silakan coba lagi." };
  }

  revalidatePath("/growth");
  return { error: null };
}

export async function logFollowerSnapshotAction(
  _prevState: GrowthActionState,
  formData: FormData,
): Promise<GrowthActionState> {
  const parsed = followerSnapshotSchema.safeParse({
    platform: formData.get("platform"),
    followerCount: formData.get("followerCount"),
    recordedAt: formData.get("recordedAt"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data tidak valid" };
  }

  const session = await requireSessionContext();
  const permissionError = requireWriteAccess(session.role);
  if (permissionError) return { error: permissionError };

  const supabase = await createClient();

  const recordedAt = parsed.data.recordedAt || new Date().toISOString().slice(0, 10);

  const { error } = await supabase.from("prompter_follower_snapshots").upsert(
    {
      tenant_id: session.tenantId,
      platform: parsed.data.platform as GrowthPlatform,
      follower_count: parsed.data.followerCount,
      recorded_at: recordedAt,
    },
    { onConflict: "tenant_id,platform,recorded_at" },
  );

  if (error) {
    return { error: "Gagal mencatat jumlah follower. Silakan coba lagi." };
  }

  revalidatePath("/growth");
  return { error: null };
}
