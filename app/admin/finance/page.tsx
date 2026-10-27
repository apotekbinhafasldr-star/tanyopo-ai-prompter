import { FinanceView } from "@/features/admin/finance-view";
import { buildDemoFinance } from "@/lib/admin/demo-data";
import { requireAdminPage } from "@/services/platform-admin";

export default async function AdminFinancePage() {
  await requireAdminPage("finance.view");
  return <FinanceView summary={buildDemoFinance().summary} demo />;
}
