import { z } from "zod";

/**
 * Request contracts for /api/v1/integrations/umkmpro/* (product spec
 * §47-57). `tenantId` is always UMKMpro's own tenant identifier for the
 * business — the same `public.tenants.id` both apps share (see
 * docs/DATABASE.md) — never something the caller invents, since it's
 * checked against a real tenants row before any write happens.
 */
export const productSyncSchema = z.object({
  tenantId: z.string().uuid(),
  sourceProductId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  price: z.number().nonnegative().nullable().optional(),
  currency: z.string().length(3).optional(),
  stock: z.number().int().nullable().optional(),
  hpp: z.number().nonnegative().nullable().optional(),
  category: z.string().nullable().optional(),
  images: z.array(z.string()).optional(),
  sourceUpdatedAt: z.string().datetime().nullable().optional(),
});

export const promotionHandoffSchema = z.object({
  tenantId: z.string().uuid(),
  sourceProductId: z.string().min(1),
  externalUserReference: z.string().nullable().optional(),
  idempotencyKey: z.string().min(1),
});

export const conversionSchema = z.object({
  tenantId: z.string().uuid(),
  externalEventId: z.string().min(1),
  eventType: z.enum(["LEAD", "SIGNUP", "ADD_TO_CART", "CHECKOUT", "PURCHASE", "SUBSCRIPTION"]),
  masterCampaignId: z.string().uuid().nullable().optional(),
  value: z.number().nonnegative().nullable().optional(),
  currency: z.string().length(3).optional(),
});

export const webhookEventSchema = z.object({
  tenantId: z.string().uuid().nullable().optional(),
  eventId: z.string().min(1),
  eventType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
});
