import { z } from "zod";

export const conversionEventTypes = [
  { value: "LEAD", label: "Lead" },
  { value: "SIGNUP", label: "Signup" },
  { value: "ADD_TO_CART", label: "Add to Cart" },
  { value: "CHECKOUT", label: "Checkout" },
  { value: "PURCHASE", label: "Purchase" },
  { value: "SUBSCRIPTION", label: "Subscription" },
] as const;

export const manualConversionSchema = z.object({
  campaignId: z.string().uuid().optional().or(z.literal("")),
  eventType: z.enum(conversionEventTypes.map((e) => e.value) as [string, ...string[]], {
    message: "Pilih jenis konversi",
  }),
  value: z.coerce.number().min(0).optional(),
  customerReference: z.string().trim().max(200).optional().or(z.literal("")),
  occurredAt: z.string().trim().optional().or(z.literal("")),
});

export type ManualConversionInput = z.infer<typeof manualConversionSchema>;
