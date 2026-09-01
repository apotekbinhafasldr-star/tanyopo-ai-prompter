import type { Metadata } from "next";
import Link from "next/link";
import { Search, Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { requireSessionContext } from "@/services/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/format";
import { SeoProjectForm } from "@/features/seo/project-form";

export const metadata: Metadata = { title: "SEO — Tanyopo AI Promoter" };

export default async function SeoPage() {
  const session = await requireSessionContext();
  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("prompter_seo_projects")
    .select("id, website_url, target_keywords, status, created_at")
    .eq("tenant_id", session.tenantId)
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">SEO</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Rekomendasi keyword, on-page, dan content plan untuk website Anda — dibuat AI berdasarkan URL dan
          konteks bisnis, bukan hasil audit langsung ke halaman (lihat catatan di detail project).
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <Globe className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle>Tambah Project SEO</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {session.role === "owner" || session.role === "marketing" ? (
            <SeoProjectForm />
          ) : (
            <p className="text-sm text-muted-foreground">Hanya Owner/Marketing yang dapat menambah project SEO.</p>
          )}
        </CardContent>
      </Card>

      {!projects || projects.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Belum ada project SEO"
          description="Tambahkan URL website Anda di atas untuk mulai mendapatkan rekomendasi SEO dari AI."
        />
      ) : (
        <div className="flex flex-col divide-y divide-border rounded-[var(--radius-lg)] border border-border">
          {projects.map((p) => (
            <Link key={p.id} href={`/seo/${p.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-surface-muted">
              <div>
                <p className="text-sm font-medium text-foreground">{p.website_url}</p>
                <p className="text-xs text-muted-foreground">
                  {(p.target_keywords as string[]).length > 0
                    ? (p.target_keywords as string[]).join(", ")
                    : "Belum ada kata kunci target"}
                  {" · "}
                  {formatDate(p.created_at)}
                </p>
              </div>
              <Badge variant={p.status === "ACTIVE" ? "success" : "neutral"}>
                {p.status === "ACTIVE" ? "Aktif" : "Dijeda"}
              </Badge>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
