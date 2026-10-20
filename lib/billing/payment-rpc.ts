import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Billing Financial Safety — thin typed access to the v2 payment RPCs
 * (supabase/migrations/20261020160000_prompter_billing_financial_safety.sql).
 * The generated `Database` types do not know these functions yet (the
 * migration is not applied anywhere), so the call goes through one narrow,
 * documented cast instead of `any` spread across the services.
 */
export interface RpcResult<T> {
  data: T | null;
  error: { message: string } | null;
}

type RpcCapable = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult<unknown>>;
};

export async function callPaymentRpc<T>(
  client: SupabaseClient<never> | SupabaseClient<any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  fn: string,
  args: Record<string, unknown>,
): Promise<RpcResult<T[]>> {
  const result = await (client as unknown as RpcCapable).rpc(fn, args);
  const raw = result.data;
  const rows = raw === null || raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  return { data: rows as T[], error: result.error };
}

export const INTENT_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BeginCheckoutOutcome =
  | "CREATED"
  | "REUSED"
  | "IN_PROGRESS"
  | "INTENT_STALE"
  | "INTENT_CLOSED"
  | "INVALID"
  | "NO_TENANT";

export interface BeginCheckoutRow {
  out_transaction_id: string | null;
  out_checkout_url: string | null;
  out_outcome: BeginCheckoutOutcome;
}

export type ApplyPaymentOutcome = "APPLIED" | "ALREADY_APPLIED" | "RECORDED" | "EXCEPTION";

export interface ApplyPaymentRow {
  result_outcome: ApplyPaymentOutcome;
  result_reason: string | null;
}
