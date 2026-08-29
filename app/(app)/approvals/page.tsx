import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { requireSessionContext } from "@/services/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatCurrency } from "@/lib/utils/format";
import { ApprovalDecideButtons } from "@/features/approvals/decide-buttons";

export const metadata: Metadata = { title: "Approvals — Tanyopo AI Promoter" };

const APPROVAL_TYPE_LABEL: Record<string, string> = {
  CAMPAIGN_LAUNCH: "Peluncuran Campaign",
  BUDGET_CHANGE: "Perubahan Budget",
  CAMPAIGN_SCALE: "Penambahan Skala Campaign",
  CONTENT_PUBLISH: "Publikasi Konten",
  AUTOPILOT_ACTION: "Aksi Autopilot",
};

const APPROVAL_STATUS_VARIANT: Record<string, "warning" | "success" | "danger" | "neutral"> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  EXPIRED: "neutral",
};

export default async function ApprovalsPage() {
  const session = await requireSessionContext();
  const supabase = await createClient();

  const { data: approvals } = await supabase
    .from("prompter_approvals")
    .select("id, approval_type, status, resource_type, resource_id, requested_by, decided_at, reason, context, created_at")
    .eq("tenant_id", session.tenantId)
    .order("created_at", { ascending: false });

  const campaignIds = [
    ...new Set(
      (approvals ?? [])
        .map((a) => {
          if (a.resource_type === "prompter_master_campaigns") return a.resource_id;
          const context = a.context as { master_campaign_id?: string };
          return context.master_campaign_id ?? null;
        })
        .filter((id): id is string => !!id),
    ),
  ];
  const { data: campaigns } = campaignIds.length
    ? await supabase.from("prompter_master_campaigns").select("id, name").in("id", campaignIds)
    : { data: [] };
  const campaignNameById = new Map((campaigns ?? []).map((c) => [c.id, c.name]));

  const requesterIds = [...new Set((approvals ?? []).map((a) => a.requested_by).filter((id): id is string => !!id))];
  const { data: requesters } = requesterIds.length
    ? await supabase.from("user_profiles").select("id, nama").in("id", requesterIds)
    : { data: [] };
  const requesterNameById = new Map((requesters ?? []).map((r) => [r.id, r.nama]));

  const pending = (approvals ?? []).filter((a) => a.status === "PENDING");
  const decided = (approvals ?? []).filter((a) => a.status !== "PENDING");

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Approval Center</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {session.role === "owner"
            ? "Tinjau pengajuan peluncuran campaign sebelum dijadwalkan."
            : "Pengajuan Anda akan direview oleh Owner sebelum campaign dijadwalkan."}
        </p>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Menunggu Persetujuan</h2>
        {pending.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="Tidak ada pengajuan menunggu" description="Semua pengajuan sudah diputuskan." />
        ) : (
          <div className="flex flex-col gap-3">
            {pending.map((a) => {
              const context = a.context as {
                daily_budget?: number | null;
                total_budget?: number | null;
                master_campaign_id?: string;
                channel?: string;
                action_type?: string;
                suggested_daily_budget?: number | null;
                rationale?: string;
                risk_level?: "LOW" | "MEDIUM" | "HIGH";
              };
              const isAutopilotAction = a.approval_type === "AUTOPILOT_ACTION";

              return (
                <Card key={a.id}>
                  <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge variant={APPROVAL_STATUS_VARIANT[a.status]}>{a.status}</Badge>
                        <span className="text-sm font-medium text-foreground">
                          {APPROVAL_TYPE_LABEL[a.approval_type] ?? a.approval_type}
                        </span>
                        {isAutopilotAction && context.risk_level ? (
                          <Badge
                            variant={
                              context.risk_level === "HIGH"
                                ? "danger"
                                : context.risk_level === "MEDIUM"
                                  ? "warning"
                                  : "neutral"
                            }
                          >
                            Risiko {context.risk_level}
                          </Badge>
                        ) : null}
                      </div>
                      {a.resource_type === "prompter_master_campaigns" ? (
                        <Link href={`/campaigns/${a.resource_id}`} className="text-sm text-brand hover:underline">
                          {campaignNameById.get(a.resource_id) ?? "Campaign"}
                        </Link>
                      ) : isAutopilotAction && context.master_campaign_id ? (
                        <Link
                          href={`/campaigns/${context.master_campaign_id}`}
                          className="text-sm text-brand hover:underline"
                        >
                          {campaignNameById.get(context.master_campaign_id) ?? "Campaign"} — {context.channel}
                        </Link>
                      ) : null}
                      <p className="mt-1 text-xs text-muted-foreground">
                        Diajukan oleh {a.requested_by ? (requesterNameById.get(a.requested_by) ?? "—") : "—"} ·{" "}
                        {formatDate(a.created_at)}
                      </p>
                      {context.total_budget ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Budget total: {formatCurrency(context.total_budget)}
                          {context.daily_budget ? ` · Harian: ${formatCurrency(context.daily_budget)}` : ""}
                        </p>
                      ) : null}
                      {isAutopilotAction ? (
                        <div className="mt-1 flex flex-col gap-1">
                          <p className="text-xs text-foreground">
                            <strong>{context.action_type?.replaceAll("_", " ")}</strong>
                            {context.suggested_daily_budget !== null && context.suggested_daily_budget !== undefined
                              ? ` — usulan budget harian ${formatCurrency(context.suggested_daily_budget)}`
                              : ""}
                          </p>
                          {context.rationale ? (
                            <p className="text-xs text-muted-foreground">{context.rationale}</p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    {session.role === "owner" ? (
                      <ApprovalDecideButtons approvalId={a.id} />
                    ) : (
                      <p className="text-xs text-muted-foreground">Menunggu Owner</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {decided.length > 0 ? (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-foreground">Riwayat</h2>
          <div className="flex flex-col divide-y divide-border rounded-[var(--radius-lg)] border border-border">
            {decided.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {APPROVAL_TYPE_LABEL[a.approval_type] ?? a.approval_type}
                    {a.resource_type === "prompter_master_campaigns"
                      ? ` — ${campaignNameById.get(a.resource_id) ?? ""}`
                      : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(a.decided_at ?? a.created_at)}
                    {a.reason ? ` · ${a.reason}` : ""}
                  </p>
                </div>
                <Badge variant={APPROVAL_STATUS_VARIANT[a.status]}>{a.status}</Badge>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
