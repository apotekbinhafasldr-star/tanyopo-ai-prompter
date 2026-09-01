import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type {
  UmkmproConversionInput,
  UmkmproProductPayload,
  UmkmproPromotionHandoffInput,
  UmkmproWebhookEventInput,
} from "@/schemas/umkmpro";
import { recordSingleTouchAttribution } from "@/services/attribution";

/**
 * Data-access layer for /api/v1/integrations/umkmpro/* (product spec
 * §46-48, §56-57). Every function here takes an already-authenticated
 * admin (service-role) client — there is no Supabase user session on a
 * signed server-to-server request, so tenant scoping is enforced in code
 * here rather than by RLS. Route handlers are responsible for verifying
 * the request signature (lib/umkmpro/auth.ts) before any of this runs.
 */

type AdminClient = SupabaseClient<Database>;

const UNIQUE_VIOLATION = "23505";

export async function tenantExists(admin: AdminClient, tenantId: string): Promise<boolean> {
  const { data } = await admin.from("tenants").select("id").eq("id", tenantId).maybeSingle();
  return !!data;
}

/**
 * Upserts the mutable `prompter_products` mirror row (so the rest of the
 * app — Promote Wizard, Marketing Blueprint — can query it like any other
 * product) and always inserts a NEW append-only `prompter_product_snapshots`
 * row (product spec §48) capturing this exact price/stock/description at
 * this exact moment, so a campaign built from it stays historically
 * accurate even after the source product changes in UMKMpro later.
 */
export async function upsertProductFromUmkmpro(
  admin: AdminClient,
  tenantId: string,
  product: UmkmproProductPayload,
): Promise<{ productId: string; snapshotId: string }> {
  const { data: upsertedProduct, error: productError } = await admin
    .from("prompter_products")
    .upsert(
      {
        tenant_id: tenantId,
        name: product.name,
        description: product.description ?? null,
        product_type: "PHYSICAL_PRODUCT",
        category: product.category ?? null,
        price: product.price ?? null,
        currency: product.currency ?? "IDR",
        stock: product.stock ?? null,
        hpp: product.hpp ?? null,
        status: "ACTIVE",
        source_system: "umkmpro",
        source_product_id: product.sourceProductId,
      },
      { onConflict: "tenant_id,source_system,source_product_id" },
    )
    .select("id")
    .single();

  if (productError || !upsertedProduct) {
    throw new Error(productError?.message ?? "Gagal menyimpan produk dari UMKMpro AI.");
  }

  const { data: snapshot, error: snapshotError } = await admin
    .from("prompter_product_snapshots")
    .insert({
      tenant_id: tenantId,
      source_system: "umkmpro",
      source_product_id: product.sourceProductId,
      linked_product_id: upsertedProduct.id,
      name: product.name,
      description: product.description ?? null,
      price: product.price ?? null,
      currency: product.currency ?? "IDR",
      stock: product.stock ?? null,
      hpp: product.hpp ?? null,
      category: product.category ?? null,
      images: product.images ?? [],
      source_updated_at: product.sourceUpdatedAt ?? null,
    })
    .select("id")
    .single();

  if (snapshotError || !snapshot) {
    throw new Error(snapshotError?.message ?? "Gagal menyimpan snapshot produk.");
  }

  return { productId: upsertedProduct.id, snapshotId: snapshot.id };
}

export interface PromotionHandoffResult {
  handoffId: string;
  alreadyExisted: boolean;
}

/**
 * Creates (or, on a retried idempotency key, returns) the one-time
 * "Promosikan dengan AI" handoff (product spec §47). Product data is synced
 * first via `upsertProductFromUmkmpro` so the handoff always points at a
 * fresh snapshot, then the handoff row itself is inserted; a duplicate
 * `idempotencyKey` for the same tenant is treated as a safe replay rather
 * than an error, since UMKMpro may legitimately retry a network failure.
 */
export async function createPromotionHandoff(
  admin: AdminClient,
  tenantId: string,
  input: UmkmproPromotionHandoffInput,
): Promise<PromotionHandoffResult> {
  const { productId, snapshotId } = await upsertProductFromUmkmpro(admin, tenantId, input.product);

  const { data: inserted, error: insertError } = await admin
    .from("prompter_promotion_handoffs")
    .insert({
      tenant_id: tenantId,
      snapshot_id: snapshotId,
      product_id: productId,
      source_system: "umkmpro",
      external_user_reference: input.externalUserReference ?? null,
      idempotency_key: input.idempotencyKey,
    })
    .select("id")
    .single();

  if (!insertError && inserted) {
    return { handoffId: inserted.id, alreadyExisted: false };
  }

  if (insertError?.code === UNIQUE_VIOLATION) {
    const { data: existing, error: fetchError } = await admin
      .from("prompter_promotion_handoffs")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("source_system", "umkmpro")
      .eq("idempotency_key", input.idempotencyKey)
      .single();

    if (!fetchError && existing) {
      return { handoffId: existing.id, alreadyExisted: true };
    }
  }

  throw new Error(insertError?.message ?? "Gagal membuat promotion handoff.");
}

/**
 * Idempotent upsert on (tenant_id, source, external_event_id) — a retried
 * event with the same id overwrites with UMKMpro's latest values rather
 * than erroring, since a corrected resend is expected behavior for a
 * conversions feed (unlike the webhook receipt log below, which is a pure
 * once-only record).
 */
export async function recordConversionFromUmkmpro(
  admin: AdminClient,
  tenantId: string,
  input: UmkmproConversionInput,
): Promise<{ conversionId: string }> {
  const { data, error } = await admin
    .from("prompter_conversions")
    .upsert(
      {
        tenant_id: tenantId,
        master_campaign_id: input.masterCampaignId ?? null,
        channel_campaign_id: input.channelCampaignId ?? null,
        customer_reference: input.customerReference ?? null,
        order_reference: input.orderReference ?? null,
        source: "umkmpro",
        event_type: input.eventType,
        value: input.value ?? null,
        currency: input.currency ?? "IDR",
        occurred_at: input.occurredAt ?? new Date().toISOString(),
        metadata: (input.metadata ?? {}) as Json,
        external_event_id: input.externalEventId,
      },
      { onConflict: "tenant_id,source,external_event_id" },
    )
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Gagal menyimpan data konversi dari UMKMpro AI.");
  }

  // Single-touch attribution to whichever campaign UMKMpro AI passed —
  // see services/attribution.ts. Re-runs (and self-corrects) on a resend
  // with the same external_event_id, matching this function's own
  // overwrite-on-resend semantics. No-ops when neither campaign id is set.
  await recordSingleTouchAttribution(admin, {
    tenantId,
    conversionId: data.id,
    masterCampaignId: input.masterCampaignId ?? null,
    channelCampaignId: input.channelCampaignId ?? null,
    value: input.value ?? null,
    model: "UMKMPRO_VERIFIED",
  });

  return { conversionId: data.id };
}

export interface WebhookReceiptResult {
  eventId: string;
  alreadyProcessed: boolean;
}

/**
 * Idempotent receipt log for the generic webhook endpoint (product spec
 * §56-57). Unlike conversions, a redelivered event is a strict no-op — the
 * unique constraint on (source_system, external_event_id) is what makes
 * that safe, and a conflict here means "already recorded," not an error.
 */
export async function recordWebhookEvent(
  admin: AdminClient,
  input: UmkmproWebhookEventInput & { status: "PROCESSED" | "IGNORED"; error?: string | null },
): Promise<WebhookReceiptResult> {
  const { data: inserted, error: insertError } = await admin
    .from("prompter_webhook_events")
    .insert({
      tenant_id: input.tenantId ?? null,
      source_system: "umkmpro",
      external_event_id: input.externalEventId,
      event_type: input.eventType,
      payload: (input.payload ?? {}) as Json,
      status: input.status,
      error: input.error ?? null,
      processed_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (!insertError && inserted) {
    return { eventId: inserted.id, alreadyProcessed: false };
  }

  if (insertError?.code === UNIQUE_VIOLATION) {
    const { data: existing, error: fetchError } = await admin
      .from("prompter_webhook_events")
      .select("id")
      .eq("source_system", "umkmpro")
      .eq("external_event_id", input.externalEventId)
      .single();

    if (!fetchError && existing) {
      return { eventId: existing.id, alreadyProcessed: true };
    }
  }

  throw new Error(insertError?.message ?? "Gagal mencatat webhook event.");
}
