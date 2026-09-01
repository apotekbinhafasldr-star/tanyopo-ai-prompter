import { z } from "zod";

/**
 * Validation for the /api/v1/integrations/umkmpro/* request bodies (product
 * spec §46-48, §56-57). Every route requires `tenantId` explicitly in the
 * body — a signed service request has no Supabase session to derive tenancy
 * from, so the caller must say which tenant it's acting for, and the route
 * handler is responsible for confirming that tenant actually exists before
 * writing anything (see services/umkmpro.ts).
 */

export const umkmproProductPayloadSchema = z.object({
  sourceProductId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().trim().optional(),
  price: z.coerce.number().min(0).optional(),
  currency: z.string().trim().length(3).optional(),
  stock: z.coerce.number().int().optional(),
  hpp: z.coerce.number().min(0).optional(),
  category: z.string().trim().optional(),
  images: z.array(z.string().url()).optional(),
  sourceUpdatedAt: z.string().datetime().optional(),
});
export type UmkmproProductPayload = z.infer<typeof umkmproProductPayloadSchema>;

export const umkmproProductSyncSchema = z.object({
  tenantId: z.string().uuid(),
  product: umkmproProductPayloadSchema,
});
export type UmkmproProductSyncInput = z.infer<typeof umkmproProductSyncSchema>;

export const umkmproPromotionHandoffSchema = z.object({
  tenantId: z.string().uuid(),
  product: umkmproProductPayloadSchema,
  externalUserReference: z.string().trim().max(200).optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
});
export type UmkmproPromotionHandoffInput = z.infer<typeof umkmproPromotionHandoffSchema>;

export const umkmproConversionSchema = z.object({
  tenantId: z.string().uuid(),
  externalEventId: z.string().trim().min(1).max(200),
  eventType: z.enum(["LEAD", "SIGNUP", "ADD_TO_CART", "CHECKOUT", "PURCHASE", "SUBSCRIPTION"]),
  value: z.coerce.number().min(0).optional(),
  currency: z.string().trim().length(3).optional(),
  occurredAt: z.string().datetime().optional(),
  orderReference: z.string().trim().max(200).optional(),
  customerReference: z.string().trim().max(200).optional(),
  masterCampaignId: z.string().uuid().optional(),
  channelCampaignId: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type UmkmproConversionInput = z.infer<typeof umkmproConversionSchema>;

export const umkmproWebhookEventSchema = z.object({
  tenantId: z.string().uuid().optional(),
  externalEventId: z.string().trim().min(1).max(200),
  eventType: z.string().trim().min(1).max(100),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type UmkmproWebhookEventInput = z.infer<typeof umkmproWebhookEventSchema>;
