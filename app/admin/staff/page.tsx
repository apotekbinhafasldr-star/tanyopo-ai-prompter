import { StaffView } from "@/features/admin/staff-view";
import { can } from "@/lib/admin/permissions";
import { isStaffMessageCode, STAFF_MESSAGES } from "@/lib/admin/staff-messages";
import { requireAdminPage } from "@/services/platform-admin";
import { listStaff } from "@/services/staff-admin";

export default async function AdminStaffPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const principal = await requireAdminPage("staff.view");
  const live = await listStaff();
  const r = (await searchParams)?.r;
  const code = Array.isArray(r) ? r[0] : r;
  const message = isStaffMessageCode(code) ? { ok: code === "ok", text: STAFF_MESSAGES[code] } : null;
  return <StaffView demo={live === null} live={live} canManage={can(principal, "staff.manage")} message={message} />;
}
