import { StaffView } from "@/features/admin/staff-view";
import { can } from "@/lib/admin/permissions";
import { requireAdminPage } from "@/services/platform-admin";
import { listStaff } from "@/services/staff-admin";

export default async function AdminStaffPage() {
  const principal = await requireAdminPage("staff.view");
  const live = await listStaff();
  return <StaffView demo={live === null} live={live} canManage={can(principal, "staff.manage")} />;
}
