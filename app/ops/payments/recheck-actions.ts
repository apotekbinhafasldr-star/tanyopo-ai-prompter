"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { checkRateLimit } from "@/lib/rate-limit";
import { isUuid } from "@/lib/billing/payment-alerts";
import { getPaymentProvider } from "@/lib/billing/get-payment-provider";
import { getPaymentOperator } from "@/services/payment-operator";
import { recheckPendingPayment } from "@/services/payment-recheck";

/**
 * P0-C — operator re-verification of a PENDING DOKU payment. Allowlisted operators only (re-checked here: a page render is
 * not authorization). The form carries only a transaction id; the outcome comes from the gateway via verifyAndSettle.
 */
export async function recheckPaymentAction(formData: FormData) {
  const operator = await getPaymentOperator();
  if (!operator) redirect("/ops/payments?r=denied&ok=0");
  const txnId = formData.get("transactionId");
  let code: string = "invalid";
  let ok = false;
  if (isUuid(txnId)) {
    if (!checkRateLimit(`ops-payments-recheck:${operator.userId}`, 6, 60_000).allowed) {
      code = "rate";
    } else {
      const result = await recheckPendingPayment(operator.admin, getPaymentProvider(), txnId, operator.userId);
      code = `recheck_${result.code}`;
      ok = result.ok;
    }
  }
  revalidatePath("/ops/payments");
  redirect(`/ops/payments?r=${code}&ok=${ok ? 1 : 0}`);
}
