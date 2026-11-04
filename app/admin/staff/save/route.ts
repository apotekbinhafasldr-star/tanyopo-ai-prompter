import { NextRequest, NextResponse } from "next/server";
import { isAdminCenterEnabled } from "@/lib/admin/flag";
import { GRANTABLE_PERMISSIONS } from "@/lib/admin/permissions";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireAdminPermission } from "@/services/platform-admin";
import { applyStaffChange } from "@/services/staff-admin";

export const dynamic = "force-dynamic";

const notFound = () => new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
const back = (request: NextRequest, code: string) => {
  const url = new URL("/admin/staff", request.nextUrl.origin);
  url.searchParams.set("r", code);
  return NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "no-store" } });
};

/**
 * Founder only (staff.manage). POST only, same-origin only, authority re-checked here on the server: hiding the
 * form is not a control. Answers with a redirect carrying a fixed result code, never text from the request.
 */
export async function POST(request: NextRequest) {
  if (!isAdminCenterEnabled()) return notFound();

  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) return notFound();

  let actor;
  try {
    actor = await requireAdminPermission("staff.manage");
  } catch {
    return notFound();
  }
  if (!checkRateLimit(`admin-staff:${actor.userId}`, 20, 60_000).allowed) return back(request, "rate");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return back(request, "invalid");
  }
  const email = form.get("email");
  if (typeof email !== "string") return back(request, "invalid");
  const permissions = form.getAll("permissions").filter((v): v is string => typeof v === "string");
  if (!permissions.every((p) => (GRANTABLE_PERMISSIONS as readonly string[]).includes(p))) return back(request, "permission");

  const result = await applyStaffChange(actor, { email, permissions, isActive: form.get("isActive") === "on" });
  return back(request, result.ok ? "ok" : result.code);
}
