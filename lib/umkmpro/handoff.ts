import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConversionEventType, Database, Json } from "@/types/database";

export type HandoffResult<T> =
  | { ok: true; data: T; alreadyProcessed?: boolean }
  | { ok: false; error: string };

export interface ProductSyncInput {
  tenantId: string;
  sourceProductId: string;
  name: string;
  description?: string | null;
  price?: number | null;
  currency?: string;
  stock?: number | null;
  hpp?: number | null;
  category?: string | null;
  images?: Json;
  sourceUpdatedAt?: string | null;
}

/**
 * Records an immutable snapshot (product spec §48) and mirrors it into
 * the live prompter_products row the rest of the app queries — the
 * snapshot itself is never mutated, only ever inserted, so a campaign
 * built from it stays historically accurate even after the source
 * product changes again in UMKMpro. Every write is service-role and
 * explicitly tenant-scoped by the caller-supplied tenantId (resolved
 * from UMKMpro's own signed request, never from client input at large).
 */
export async function recordProductSnapshot(
  admin: SupabaseClient<Database>,
  input: ProductSyncInput,
): Promise<HandoffResult<{ snapshotId: string; productId: string }>> {
  const { data: snapshot, error: snapshotError } = await admin
    .from("prompter_product_snapshots")
    .insert({
      tenant_id: input.tenantId,
      source_system: "umkmpro",
      source_product_id: input.sourceProductId,
      name: input.name,
      description: input.description ?? null,
      price: input.price ?? null,
      currency: input.currency ?? "IDR",
      stock: input.stock ?? null,
      hpp: input.hpp ?? null,
      category: input.category ?? null,
      images: input.images ?? [],
      source_updated_at: input.sourceUpdatedAt ?? null,
    })
    .select("id")
    .single();

  if (snapshotError || !snapshot) {
    return { ok: false, error: `Gagal menyimpan snapshot produk: ${snapshotError?.message}` };
  }

  // Upsert the live mirror by (tenant_id, source_system, source_product_id)
  // — see prompter_products_source_unique in the Phase 4 migration.
  const { data: product, error: productError } = await admin
    .from("prompter_products")
    .upsert(
      {
        tenant_id: input.tenantId,
        name: input.name,
        description: input.description ?? null,
        product_type: "PHYSICAL_PRODUCT",
        category: input.category ?? null,
        price: input.price ?? undefined,
        stock: input.stock ?? undefined,
        hpp: input.hpp ?? undefined,
      },
      { onConflict: "tenant_id,source_system,source_product_id" },
    )
    .select("id")
    .single();

  if (productError || !product) {
    return { ok: false, error: `Snapshot tersimpan tapi gagal memperbarui produk: ${productError?.message}` };
  }

  await admin
    .from("prompter_product_snapshots")
    .update({ linked_product_id: product.id })
    .eq("id", snapshot.id);

  return { ok: true, data: { snapshotId: snapshot.id, productId: product.id } };
}

export interface PromotionHandoffInput {
  tenantId: string;
  snapshotId?: string | null;
  productId?: string | null;
  externalUserReference?: string | null;
  idempotencyKey: string;
}

/**
 * Creates the one-time "Promosikan dengan AI" handoff (product spec
 * §47). Idempotent on (tenant_id, source_system, idempotency_key) — a
 * retried request with the same key returns the existing handoff rather
 * than creating a duplicate.
 */
export async function createPromotionHandoff(
  admin: SupabaseClient<Database>,
  input: PromotionHandoffInput,
): Promise<HandoffResult<{ handoffId: string }>> {
  const { data: existing } = await admin
    .from("prompter_promotion_handoffs")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .eq("source_system", "umkmpro")
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();

  if (existing) {
    return { ok: true, data: { handoffId: existing.id }, alreadyProcessed: true };
  }

  const { data, error } = await admin
    .from("prompter_promotion_handoffs")
    .insert({
      tenant_id: input.tenantId,
      snapshot_id: input.snapshotId ?? null,
      product_id: input.productId ?? null,
      source_system: "umkmpro",
      external_user_reference: input.externalUserReference ?? null,
      idempotency_key: input.idempotencyKey,
    })
    .select("id")
    .single();

  if (error || !data) return { ok: false, error: `Gagal membuat handoff promosi: ${error?.message}` };
  return { ok: true, data: { handoffId: data.id } };
}

/**
 * Idempotent webhook receipt (product spec §56-57). A redelivery with
 * the same (source_system, external_event_id) is a safe no-op — the
 * unique constraint on prompter_webhook_events is what enforces this at
 * the database level, not application-side locking.
 */
export async function recordWebhookEvent(
  admin: SupabaseClient<Database>,
  params: { tenantId: string | null; externalEventId: string; eventType: string; payload: Json },
): Promise<HandoffResult<{ eventId: string }>> {
  const { data: existing } = await admin
    .from("prompter_webhook_events")
    .select("id, status")
    .eq("source_system", "umkmpro")
    .eq("external_event_id", params.externalEventId)
    .maybeSingle();

  if (existing) {
    return { ok: true, data: { eventId: existing.id }, alreadyProcessed: true };
  }

  const { data, error } = await admin
    .from("prompter_webhook_events")
    .insert({
      tenant_id: params.tenantId,
      source_system: "umkmpro",
      external_event_id: params.externalEventId,
      event_type: params.eventType,
      payload: params.payload,
      status: params.tenantId ? "RECEIVED" : "IGNORED",
    })
    .select("id")
    .single();

  if (error || !data) return { ok: false, error: `Gagal mencatat webhook event: ${error?.message}` };
  return { ok: true, data: { eventId: data.id } };
}

export async function markWebhookEventProcessed(
  admin: SupabaseClient<Database>,
  eventId: string,
  outcome: { status: "PROCESSED" | "FAILED"; error?: string },
): Promise<void> {
  await admin
    .from("prompter_webhook_events")
    .update({ status: outcome.status, error: outcome.error ?? null, processed_at: new Date().toISOString() })
    .eq("id", eventId);
}

export interface ConversionInput {
  tenantId: string;
  externalEventId: string;
  eventType: ConversionEventType;
  masterCampaignId?: string | null;
  value?: number | null;
  currency?: string;
}

/**
 * Records a conversion pushed from UMKMpro, idempotent on
 * (tenant_id, source, external_event_id) — see the Phase 4 migration's
 * prompter_conversions_external_event_unique constraint.
 * `ignoreDuplicates` makes the unique-violation path a silent no-op
 * (count comes back 0) instead of an error, which is exactly "safe
 * replay" for a webhook redelivery.
 */
export async function recordConversion(
  admin: SupabaseClient<Database>,
  input: ConversionInput,
): Promise<HandoffResult<{ alreadyProcessed: boolean }>> {
  const { error, count } = await admin
    .from("prompter_conversions")
    .upsert(
      {
        tenant_id: input.tenantId,
        master_campaign_id: input.masterCampaignId ?? null,
        source: "umkmpro",
        event_type: input.eventType,
        external_event_id: input.externalEventId,
        value: input.value ?? null,
        currency: input.currency ?? "IDR",
      },
      { onConflict: "tenant_id,source,external_event_id", ignoreDuplicates: true, count: "exact" },
    );

  if (error) return { ok: false, error: `Gagal mencatat konversi: ${error.message}` };
  return { ok: true, data: { alreadyProcessed: count === 0 } };
}
