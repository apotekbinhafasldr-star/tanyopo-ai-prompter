import { StaffView } from "@/features/admin/staff-view";
import { requireAdminPage } from "@/services/platform-admin";

export default async function AdminStaffPage() {
  await requireAdminPage("staff.view");
  return <StaffView demo />;
}
