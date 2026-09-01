import { z } from "zod";

export const growthPlatforms = [
  { value: "FACEBOOK", label: "Facebook" },
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "TIKTOK", label: "TikTok" },
  { value: "X", label: "X" },
] as const;

const platformEnum = z.enum(growthPlatforms.map((p) => p.value) as [string, ...string[]], {
  message: "Pilih platform",
});

export const growthGoalSchema = z.object({
  platform: platformEnum,
  targetFollowers: z.coerce.number().int().min(0, "Target tidak boleh negatif"),
  targetDate: z.string().trim().optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});
export type GrowthGoalInput = z.infer<typeof growthGoalSchema>;

export const followerSnapshotSchema = z.object({
  platform: platformEnum,
  followerCount: z.coerce.number().int().min(0, "Jumlah follower tidak boleh negatif"),
  recordedAt: z.string().trim().optional().or(z.literal("")),
});
export type FollowerSnapshotInput = z.infer<typeof followerSnapshotSchema>;
