import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  DollarSign,
  Wallet,
  Target,
  Users,
  UserPlus,
  Globe,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/features/dashboard/metric-card";
import { AiInsightCard } from "@/features/dashboard/ai-insight-card";
import { requireSessionContext } from "@/services/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Overview — Tanyopo AI Promoter",
};

function greeting() {
  const hour = new Date().getHours();
  if (hour < 11) return "Selamat pagi";
  if (hour < 15) return "Selamat siang";
  if (hour < 19) return "Selamat sore";
  return "Selamat malam";
}

export default async function DashboardPage() {
  const session = await requireSessionContext();
  const supabase = await createClient();

  const { data: insight } = await supabase
    .from("prompter_analytics_insights")
    .select("summary, top_channel, underperforming_channels, updated_at")
    .eq("tenant_id", session.tenantId)
    .maybeSingle();

  return (
    <div className="flex flex-1 flex-col gap-8 p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            {greeting()}, {session.userName.split(" ")[0]}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {session.businessName}
          </h1>
        </div>
        <Button asChild size="lg">
          <Link href="/promote">
            <Plus />
            Promosikan Produk
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Marketing Health" icon={Activity} />
        <MetricCard label="Revenue dari Marketing" icon={DollarSign} />
        <MetricCard label="Ad Spend" icon={Wallet} />
        <MetricCard label="ROAS" icon={Target} />
        <MetricCard label="Konversi" icon={Users} />
        <MetricCard label="Followers Baru" icon={UserPlus} />
        <MetricCard label="Trafik Website" icon={Globe} />
      </div>

      <AiInsightCard insight={insight ?? null} />
    </div>
  );
}
