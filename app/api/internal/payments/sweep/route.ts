import type { NextRequest } from "next/server";
import { getPaymentProvider } from "@/lib/billing/get-payment-provider";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiError, apiSuccess } from "@/lib/api/response";
import { isAuthorizedProcessorRequest } from "@/lib/jobs/authorize-processor";
import { sweepPendingPayments } from "@/services/payment-sweeper";

/**
 * C2 — called by the Netlify scheduled function netlify/functions/payment-pending-sweep.ts. Bearer secret
 * PAYMENT_SWEEPER_SECRET; unset means this always answers NOT_CONFIGURED. It only re-checks EXISTING PENDING
 * transactions through verifyAndSettle() (the gateway decides) and never creates a transaction.
 *
 * NOTE: proxy.ts redirects unauthenticated /api/internal/* requests to /login, so this endpoint stays unreachable until
 * a separately approved one-line exemption for this exact path is added there (see the PR description).
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const secret = process.env.PAYMENT_SWEEPER_SECRET;
  if (!secret) {
    return apiError("NOT_CONFIGURED", "Sweeper belum dikonfigurasi.", 503);
  }
  if (!isAuthorizedProcessorRequest(request.headers.get("authorization"), secret)) {
    return apiError("UNAUTHORIZED", "Token tidak valid.", 401);
  }

  const admin = createAdminClient();
  if (!admin) {
    return apiError("NOT_CONFIGURED", "Server belum dikonfigurasi.", 503);
  }

  const result = await sweepPendingPayments(admin, getPaymentProvider());
  if (result.status === "not_configured") {
    return apiError("NOT_CONFIGURED", "Penyedia pembayaran belum dikonfigurasi.", 503);
  }
  if (result.status === "error") {
    return apiError("SWEEP_FAILED", "Sweeper gagal membaca transaksi.", 500);
  }
  return apiSuccess(result);
}
