import { OverviewView } from "@/features/admin/overview-view";
import { buildDemoFinance } from "@/lib/admin/demo-data";
import { can } from "@/lib/admin/permissions";
import { requireAdminPage } from "@/services/platform-admin";

export default async function AdminOverviewPage() {
  const principal = await requireAdminPage("admin.overview");
  // Demo data until the finance migration is approved; the summary is only built for people who may see finance.
  const summary = can(principal, "finance.view") ? buildDemoFinance().summary : null;
  return <OverviewView principal={principal} summary={summary} demo />;
}
