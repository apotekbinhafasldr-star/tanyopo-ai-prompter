import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPaymentOperator } from "@/services/payment-alerts";
import type { Database } from "@/types/database";

export interface PaymentOperator {
  userId: string;
  admin: SupabaseClient<Database>;
}

/**
 * Billing B4.1 — the ONLY gate of the payment queue. Order: a real Supabase session (cookie, verified with
 * auth.getUser(), not a decoded cookie) -> the service_role client exists -> the user id is on the dedicated allowlist
 * (prompter_payment_operators, active). Anything else returns null; callers answer 404 so the page's existence is not
 * revealed. Being a tenant owner, a platform admin or a finance admin grants nothing here.
 */
export async function getPaymentOperator(): Promise<PaymentOperator | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createAdminClient();
  if (!admin) return null;

  if (!(await isPaymentOperator(admin, user.id))) return null;
  return { userId: user.id, admin };
}
