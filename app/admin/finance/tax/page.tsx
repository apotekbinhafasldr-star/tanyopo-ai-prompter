import { TaxView } from "@/features/admin/tax-view";
import { buildDemoFinance } from "@/lib/admin/demo-data";
import { requireAdminPage } from "@/services/platform-admin";

export default async function AdminTaxPage() {
  await requireAdminPage("tax.view");
  return <TaxView recap={buildDemoFinance().recap} demo />;
}
