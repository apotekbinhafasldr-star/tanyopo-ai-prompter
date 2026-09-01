import { z } from "zod";

export const budgetPolicySchema = z.object({
  dailyLimit: z.coerce.number().min(0).optional(),
  monthlyLimit: z.coerce.number().min(0).optional(),
  campaignLimit: z.coerce.number().min(0).optional(),
  requireApprovalAbove: z.coerce.number().min(0).optional(),
});

export type BudgetPolicyInput = z.infer<typeof budgetPolicySchema>;
