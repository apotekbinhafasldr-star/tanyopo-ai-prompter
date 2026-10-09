import { vi } from "vitest";

/**
 * Shared Supabase test doubles for the External Budget Safety Gate tests.
 * Every table access is recorded in `touched` so tests can prove that a
 * denial happened BEFORE credentials, claims, status updates or audit writes.
 */

type Result = { data: unknown; error: unknown };

export interface LaunchHarnessOptions {
  channel?: string;
  settings?: Result | "throw";
  rows?: { id: string; channel: string; budget_percentage: number | null }[];
}

export function buildLaunchHarness(options: LaunchHarnessOptions = {}) {
  const touched: string[] = [];
  const claimUpdate = vi.fn(() => ({
    eq: () => ({ eq: () => ({ eq: () => ({ select: async () => ({ data: [{ id: "cc1" }], error: null }) }) }) }),
  }));
  const auditInsert = vi.fn(async (..._args: unknown[]) => ({ error: null }));
  const adminFrom = vi.fn();

  const channelSingle = async () => ({
    data: { id: "cc1", channel: options.channel ?? "FACEBOOK", master_campaign_id: "mc1" },
    error: null,
  });
  const masterSingle = async () => ({
    data: {
      id: "mc1",
      status: "SCHEDULED",
      name: "Promo",
      objective: "INCREASE_SALES",
      currency: "IDR",
      daily_budget: 100000,
      total_budget: null,
      ai_proposal: null,
    },
    error: null,
  });
  const rowsResult = {
    data: options.rows ?? [
      { id: "cc1", channel: "FACEBOOK", budget_percentage: 50 },
      { id: "cc2", channel: "TIKTOK", budget_percentage: 30 },
      { id: "cc3", channel: "X", budget_percentage: 20 },
    ],
    error: null,
  };

  const from = vi.fn((table: string) => {
    touched.push(table);
    switch (table) {
      case "prompter_channel_campaigns":
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: channelSingle,
                then: (resolve: (value: typeof rowsResult) => unknown) => resolve(rowsResult),
              }),
            }),
          }),
          update: claimUpdate,
        };
      case "prompter_master_campaigns":
        return { select: () => ({ eq: () => ({ eq: () => ({ single: masterSingle }) }) }) };
      case "prompter_budget_policies":
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
      case "prompter_marketing_metrics":
        return { select: () => ({ eq: () => ({ gte: async () => ({ data: [], error: null }) }) }) };
      case "prompter_automation_settings":
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                if (options.settings === "throw") throw new Error("settings query exploded");
                return options.settings ?? { data: null, error: null };
              },
            }),
          }),
        };
      case "prompter_connected_accounts":
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: "acct1", external_account_id: "act_123", status: "CONNECTED", selected_page_id: "page_1" },
                  error: null,
                }),
              }),
            }),
          }),
        };
      case "prompter_audit_logs":
        return { insert: auditInsert };
      default:
        throw new Error(`Unexpected table: ${table}`);
    }
  });

  return { from, touched, claimUpdate, auditInsert, adminFrom };
}

export interface ApprovalHarnessOptions {
  actionType: string;
  channel?: string;
  suggestedDailyBudget?: number | null;
  settings?: Result | "throw";
}

export function buildApprovalHarness(options: ApprovalHarnessOptions) {
  const touched: string[] = [];
  const approvalUpdates: Record<string, unknown>[] = [];
  const channelUpdates: Record<string, unknown>[] = [];
  const auditInsert = vi.fn(async (..._args: unknown[]) => ({ error: null }));
  const adminFrom = vi.fn((table: string) => {
    touched.push(`admin:${table}`);
    return {
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { encrypted_access_token: "cipher" }, error: null }) }),
      }),
    };
  });

  const approvalRow = {
    id: "ap1",
    approval_type: "AUTOPILOT_ACTION",
    status: "PENDING",
    resource_type: "prompter_channel_campaigns",
    resource_id: "cc1",
    context: {
      action_type: options.actionType,
      suggested_daily_budget: options.suggestedDailyBudget === undefined ? 60000 : options.suggestedDailyBudget,
    },
  };

  const from = vi.fn((table: string) => {
    touched.push(table);
    switch (table) {
      case "prompter_approvals":
        return {
          select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: approvalRow, error: null }) }) }) }),
          update: (payload: Record<string, unknown>) => {
            approvalUpdates.push(payload);
            return { eq: async () => ({ error: null }) };
          },
        };
      case "prompter_automation_settings":
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                if (options.settings === "throw") throw new Error("settings query exploded");
                return options.settings ?? { data: null, error: null };
              },
            }),
          }),
        };
      case "prompter_channel_campaigns":
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: "cc1",
                    channel: options.channel ?? "FACEBOOK",
                    status: "ACTIVE",
                    external_campaign_id: "ext_campaign_1",
                  },
                  error: null,
                }),
              }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            channelUpdates.push(payload);
            return { eq: async () => ({ error: null }) };
          },
        };
      case "prompter_connected_accounts":
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: "acct1", external_account_id: "act_123", status: "CONNECTED" },
                  error: null,
                }),
              }),
            }),
          }),
        };
      case "prompter_audit_logs":
        return { insert: auditInsert };
      default:
        throw new Error(`Unexpected table: ${table}`);
    }
  });

  return { from, adminFrom, touched, approvalUpdates, channelUpdates, auditInsert };
}
