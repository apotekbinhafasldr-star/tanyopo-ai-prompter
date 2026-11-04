import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  evaluateStaffChange,
  isPermission,
  type AdminPrincipal,
  type Permission,
  type PlatformRole,
  isPlatformRole,
} from "@/lib/admin/permissions";
import { recordAdminAudit } from "@/services/admin-audit";

/**
 * Staff access management (Founder only). Uses the service-role client on finance_platform_admins, which has RLS
 * on and no policies, so nothing but trusted server code can touch it. The decision itself comes from the pure,
 * tested `evaluateStaffChange`; the database also enforces the permission whitelist and keeps the last Super Admin.
 * Every change is written to the immutable audit log BEFORE it is applied, and aborts if the log cannot be written.
 */
export interface StaffRow {
  readonly userId: string;
  readonly email: string | null;
  readonly role: PlatformRole;
  readonly isActive: boolean;
  readonly permissions: readonly Permission[];
}

type Result = { data: Record<string, unknown>[] | null; error: { message: string } | null; count?: number | null };
interface Q extends PromiseLike<Result> {
  select(columns: string, options?: { count?: "exact"; head?: boolean }): Q;
  eq(column: string, value: unknown): Q;
  is(column: string, value: null): Q;
  order(column: string): Q;
  upsert(row: Record<string, unknown>, options: { onConflict: string }): Q;
}
type Db = { from: (table: string) => Q };

const TABLE = "finance_platform_admins";
const MAX_USER_PAGES = 20;
const PAGE_SIZE = 200;

async function emailOf(userId: string): Promise<string | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    return data.user?.email ?? null;
  } catch {
    return null;
  }
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  const wanted = email.trim().toLowerCase();
  for (let page = 1; page <= MAX_USER_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) return null;
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === wanted);
    if (hit) return hit.id;
    if (data.users.length < PAGE_SIZE) return null;
  }
  return null;
}

/** Live list, or null when the admin tables are not reachable (the screen then shows the demo list). */
export async function listStaff(): Promise<StaffRow[] | null> {
  try {
    const admin = createAdminClient();
    if (!admin) return null;
    const { data, error } = await (admin as unknown as Db).from(TABLE).select("user_id, role, is_active, revoked_at, permissions").order("granted_at");
    if (error || !data) return null;
    const rows: StaffRow[] = [];
    for (const r of data) {
      const role = String(r.role);
      if (!isPlatformRole(role)) continue;
      const stored = Array.isArray(r.permissions) ? r.permissions.map(String) : [];
      rows.push({
        userId: String(r.user_id),
        email: await emailOf(String(r.user_id)),
        role,
        isActive: r.is_active === true && !r.revoked_at,
        permissions: role === "SUPER_ADMIN" ? [] : stored.filter(isPermission),
      });
    }
    return rows;
  } catch {
    return null;
  }
}

export type ApplyResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export async function applyStaffChange(actor: AdminPrincipal, input: { email: string; permissions: readonly string[]; isActive: boolean }): Promise<ApplyResult> {
  const admin = createAdminClient();
  if (!admin) return { ok: false, reason: "Admin Center belum dikonfigurasi" };
  const db = admin as unknown as Db;

  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { ok: false, reason: "Format email tidak valid" };
  const permissions = [...new Set(input.permissions)].filter((p): p is Permission => isPermission(p));
  if (permissions.length !== new Set(input.permissions).size) return { ok: false, reason: "Ada izin yang tidak dikenal" };

  const targetId = await findUserIdByEmail(email);
  if (!targetId) return { ok: false, reason: "Akun dengan email itu belum terdaftar. Minta orangnya mendaftar dulu." };

  const { data: existing, error: e1 } = await db.from(TABLE).select("user_id, role, is_active").eq("user_id", targetId);
  if (e1) return { ok: false, reason: "Tidak dapat membaca data admin" };
  const row = existing?.[0];
  const targetRole = row ? String(row.role) : "STAFF";
  const target = row && isPlatformRole(targetRole) ? { userId: targetId, role: targetRole, isActive: row.is_active === true } : null;
  if (row && !target) return { ok: false, reason: "Peran akun ini tidak dikenal" };

  const { count, error: e2 } = await db.from(TABLE).select("user_id", { count: "exact", head: true }).eq("role", "SUPER_ADMIN").eq("is_active", true).is("revoked_at", null);
  if (e2) return { ok: false, reason: "Tidak dapat memverifikasi Super Admin aktif" };

  const decision = evaluateStaffChange(actor, target, { role: "STAFF", permissions, isActive: input.isActive }, count ?? 0);
  if (!decision.ok) return decision;

  const audited = await recordAdminAudit({
    actorId: actor.userId,
    action: "staff.access.change",
    entityType: "platform_admin",
    entityId: targetId,
    details: { permissions, isActive: input.isActive, existed: Boolean(row) },
  });
  if (!audited) return { ok: false, reason: "Log audit gagal ditulis, perubahan dibatalkan" };

  const now = new Date().toISOString();
  const { error } = await db.from(TABLE).upsert(
    {
      user_id: targetId,
      role: "STAFF",
      permissions,
      is_active: input.isActive,
      revoked_at: input.isActive ? null : now,
      granted_by: actor.userId,
      granted_at: now,
    },
    { onConflict: "user_id" },
  );
  if (error) return { ok: false, reason: "Perubahan gagal disimpan" };
  return { ok: true };
}
