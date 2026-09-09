/**
 * Batch B4 hotfix. The browser now uploads product media bytes directly
 * to Supabase Storage (features/products/media-uploader.tsx) and only
 * sends the resulting storage path to recordProductMediaAction
 * (features/products/actions.ts) to record. Storage's own tenant-scoped
 * RLS already guarantees a path was written into the right tenant's
 * folder (see the "Tenant kelola file marketing miliknya sendiri" policy
 * in supabase/migrations/20260829092303_prompter_phase1_schema.sql), but
 * this is a second, defense-in-depth check on the metadata-write side: a
 * tampered client call can't attribute some other path — even one inside
 * the same tenant's folder but under a different product — into this
 * product's media library.
 */
export function isOwnProductMediaPath(storagePath: string, tenantId: string, productId: string): boolean {
  return storagePath.startsWith(`${tenantId}/${productId}/`);
}
