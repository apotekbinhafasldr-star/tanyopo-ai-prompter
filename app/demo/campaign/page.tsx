import { requireDemoSession } from "@/lib/demo/is-demo-request";
import { DemoCampaignLauncher } from "@/features/demo/campaign-launcher";

export default async function DemoCampaignPage() {
  await requireDemoSession();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Campaign &amp; Approval (Demo)</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Alur persetujuan dan peluncuran campaign — sepenuhnya simulasi, tidak terhubung ke Meta Ads/TikTok
          Ads nyata dan tidak menggunakan anggaran iklan sungguhan.
        </p>
      </div>

      <DemoCampaignLauncher />
    </div>
  );
}
