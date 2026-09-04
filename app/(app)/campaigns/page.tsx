import type { Metadata } from "next";
import Link from "next/link";
import { Rocket, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { requireSessionContext } from "@/services/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, channelLabel, campaignStatusLabel, campaignStatusVariant, goalLabel } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Campaigns — LINOE" };

export default async function CampaignsPage() {
  const session = await requireSessionContext();
  const supabase = await createClient();

  const { data: campaigns } = await supabase
    .from("prompter_master_campaigns")
    .select("id, name, objective, channels, status, created_at, product_id")
    .eq("tenant_id", session.tenantId)
    .order("created_at", { ascending: false });

  const productIds = [...new Set((campaigns ?? []).map((c) => c.product_id).filter((id): id is string => !!id))];
  const { data: products } = productIds.length
    ? await supabase.from("prompter_products").select("id, name").in("id", productIds)
    : { data: [] };
  const productNameById = new Map((products ?? []).map((p) => [p.id, p.name]));

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Campaigns</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Campaign yang dibuat AI dari Promote Wizard. Ajukan untuk persetujuan di halaman detail — peluncuran
            nyata ke channel tersedia setelah Connection Center aktif (Phase 3).
          </p>
        </div>
        <Button asChild>
          <Link href="/promote">
            <Plus />
            Buat Campaign
          </Link>
        </Button>
      </div>

      {!campaigns || campaigns.length === 0 ? (
        <EmptyState
          icon={Rocket}
          title="Belum ada campaign"
          description="Gunakan Promote Wizard untuk membuat campaign pertama dengan bantuan AI."
          action={
            <Button asChild size="sm">
              <Link href="/promote">Buat Campaign Pertama</Link>
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs font-medium text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Campaign</th>
                <th className="px-4 py-3">Produk</th>
                <th className="px-4 py-3">Channel</th>
                <th className="px-4 py-3">Tujuan</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Tanggal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-surface">
              {campaigns.map((c) => (
                <tr key={c.id} className="hover:bg-surface-muted">
                  <td className="px-4 py-3">
                    <Link href={`/campaigns/${c.id}`} className="font-medium text-foreground hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {(c.product_id && productNameById.get(c.product_id)) ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {(c.channels as string[]).map(channelLabel).join(", ") || "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{goalLabel(c.objective)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={campaignStatusVariant(c.status)}>
                      {campaignStatusLabel(c.status)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
