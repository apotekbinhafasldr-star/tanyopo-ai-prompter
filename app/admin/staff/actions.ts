"use server";

import { revalidatePath } from "next/cache";
import { checkRateLimit } from "@/lib/rate-limit";
import { GRANTABLE_PERMISSIONS } from "@/lib/admin/permissions";
import { requireAdminPermission } from "@/services/platform-admin";
import { isAdminCenterEnabled } from "@/lib/admin/flag";
import { applyStaffChange } from "@/services/staff-admin";

export interface StaffFormState {
  readonly ok: boolean | null;
  readonly message: string | null;
}

/**
 * Founder-only. Re-checks the permission on the server (a page render is not authorization), rate-limits, and
 * never echoes anything from the request back except fixed messages.
 */
export async function saveStaffAction(_prev: StaffFormState, formData: FormData): Promise<StaffFormState> {
  if (!isAdminCenterEnabled()) return { ok: false, message: "Tidak diizinkan" };
  let actor;
  try {
    actor = await requireAdminPermission("staff.manage");
  } catch {
    return { ok: false, message: "Tidak diizinkan" };
  }
  if (!checkRateLimit(`admin-staff:${actor.userId}`, 20, 60_000).allowed) return { ok: false, message: "Terlalu sering, coba lagi sebentar" };

  const email = formData.get("email");
  if (typeof email !== "string") return { ok: false, message: "Email wajib diisi" };
  const permissions = formData.getAll("permissions").filter((v): v is string => typeof v === "string");
  const isActive = formData.get("isActive") === "on";
  if (!permissions.every((p) => (GRANTABLE_PERMISSIONS as readonly string[]).includes(p))) return { ok: false, message: "Ada izin yang tidak boleh diberikan" };

  const result = await applyStaffChange(actor, { email, permissions, isActive });
  if (!result.ok) return { ok: false, message: result.reason };
  revalidatePath("/admin/staff");
  return { ok: true, message: "Akses staf disimpan" };
}
