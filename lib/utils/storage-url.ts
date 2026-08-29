import { publicEnv } from "@/lib/env";

/**
 * Builds a public URL for an object in one of Promoter's public Storage
 * buckets (product-media, creative-assets, brand-assets, generated-content
 * — see docs/DATABASE.md). Safe to call from Server or Client Components;
 * doesn't require a Supabase client since these buckets are public-read.
 */
export function publicStorageUrl(bucket: string, path: string) {
  return `${publicEnv.supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
}
