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
 *
 * Audit model (NOT atomic, by design of the app layer; see docs/ADMIN_CENTER.md "Audit staf"):
 *   1. `staff.access.change.attempt`    written BEFORE the change, with actor_id. If it cannot be written, nothing changes.
 *   2. the change is applied (insert for a new row, role-guarded update for an existing STAFF row);
 *   3. `staff.access.change.succeeded` or `.failed` is written with the same attemptId and an explicit outcome.
 * An attempt with no terminal event means the outcome is UNKNOWN (the process died or the outcome write failed); the
 * authoritative record of what really changed is the database trigger on finance_platform_admins (same transaction as
 * the row change), which stores the new row but not the actor.
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
  insert(row: Record<string, unknown>): Q;
  update(row: Record<string, unknown>): Q;
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

/** Exported for tests. Distinguishes "not found" from "gave up searching" and from "found but unconfirmed". */
export const USER_SEARCH_LIMIT = { pages: MAX_USER_PAGES, perPage: PAGE_SIZE } as const;
export type UserLookup =
  | { readonly kind: "found"; readonly userId: string }
  | { readonly kind: "unconfirmed" }
  | { readonly kind: "none" }
  | { readonly kind: "limit" }
  | { readonly kind: "error" };

export async function lookupUserByEmail(email: string): Promise<UserLookup> {
  const admin = createAdminClient();
  if (!admin) return { kind: "error" };
  const wanted = email.trim().toLowerCase();
  for (let page = 1; page <= MAX_USER_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error || !data) return { kind: "error" };
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === wanted);
    if (hit) {
      // Fail closed: access is granted only to an account whose email was confirmed. An unconfirmed account could
      // belong to someone who merely typed this address at sign-up.
      return hit.email_confirmed_at ? { kind: "found", userId: hit.id } : { kind: "unconfirmed" };
    }
    if (data.users.length < PAGE_SIZE) return { kind: "none" };
  }
  // The scan stops after MAX_USER_PAGES full pages: "not found" would be a guess, so say so instead.
  return { kind: "limit" };
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

export type StaffFailCode = "config" | "format" | "permission" | "unregistered" | "unconfirmed" | "search_limit" | "rules" | "audit" | "conflict" | "failed";
export type ApplyResult =
  | { readonly ok: true; /** false when the change was saved but its outcome event could not be written. */ readonly outcomeLogged: boolean }
  | { readonly ok: false; readonly code: StaffFailCode };

const ACTION = "staff.access.change";

async function logOutcome(actorId: string, targetId: string, attemptId: string, outcome: "SUCCEEDED" | "FAILED", extra: Record<string, unknown>): Promise<boolean> {
  const ok = await recordAdminAudit({
    actorId,
    action: `${ACTION}.${outcome === "SUCCEEDED" ? "succeeded" : "failed"}`,
    entityType: "platform_admin",
    entityId: targetId,
    details: { attemptId, outcome, ...extra },
  });
  // No PII: ids only. Lets an operator find attempts whose terminal event is missing.
  if (!ok) console.error("[staff-access] outcome event NOT recorded", { attemptId, outcome });
  return ok;
}

export async function applyStaffChange(actor: AdminPrincipal, input: { email: string; permissions: readonly string[]; isActive: boolean }): Promise<ApplyResult> {
  const admin = createAdminClient();
  if (!admin) return { ok: false, code: "config" };
  const db = admin as unknown as Db;

  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { ok: false, code: "format" };
  const permissions = [...new Set(input.permissions)].filter((p): p is Permission => isPermission(p));
  if (permissions.length !== new Set(input.permissions).size) return { ok: false, code: "permission" };

  const found = await lookupUserByEmail(email);
  if (found.kind === "none") return { ok: false, code: "unregistered" };
  if (found.kind === "unconfirmed") return { ok: false, code: "unconfirmed" };
  if (found.kind === "limit") return { ok: false, code: "search_limit" };
  if (found.kind === "error") return { ok: false, code: "failed" };
  const targetId = found.userId;

  const { data: existing, error: e1 } = await db.from(TABLE).select("user_id, role, is_active").eq("user_id", targetId);
  if (e1) return { ok: false, code: "failed" };
  const row = existing?.[0];
  const targetRole = row ? String(row.role) : "STAFF";
  const target = row && isPlatformRole(targetRole) ? { userId: targetId, role: targetRole, isActive: row.is_active === true } : null;
  if (row && !target) return { ok: false, code: "rules" };

  const { count, error: e2 } = await db.from(TABLE).select("user_id", { count: "exact", head: true }).eq("role", "SUPER_ADMIN").eq("is_active", true).is("revoked_at", null);
  if (e2) return { ok: false, code: "failed" };

  const decision = evaluateStaffChange(actor, target, { role: "STAFF", permissions, isActive: input.isActive }, count ?? 0);
  if (!decision.ok) return { ok: false, code: "rules" };

  // 1. attempt: must be recorded, or nothing changes.
  const attemptId = crypto.randomUUID();
  const attempted = await recordAdminAudit({
    actorId: actor.userId,
    action: `${ACTION}.attempt`,
    entityType: "platform_admin",
    entityId: targetId,
    details: { attemptId, permissions, isActive: input.isActive, existed: Boolean(row) },
  });
  if (!attempted) return { ok: false, code: "audit" };

  // 2. the change. A new row is an INSERT (a concurrent insert for the same user fails on the primary key). An
  // existing row is UPDATED only while it is still a STAFF row, so a row that became SUPER_ADMIN meanwhile is never
  // overwritten, and a row changed by someone else is reported as a conflict instead of silently replaced.
  const now = new Date().toISOString();
  const values = {
    role: "STAFF",
    permissions,
    is_active: input.isActive,
    revoked_at: input.isActive ? null : now,
    granted_by: actor.userId,
    granted_at: now,
  };
  let failure: StaffFailCode | null = null;
  if (!row) {
    const { error } = await db.from(TABLE).insert({ user_id: targetId, ...values });
    if (error) failure = "conflict";
  } else {
    const { data, error } = await db.from(TABLE).update(values).eq("user_id", targetId).eq("role", "STAFF").eq("is_active", row.is_active === true).select("user_id");
    if (error) failure = "failed";
    else if (!data || data.length !== 1) failure = "conflict";
  }

  // 3. outcome.
  if (failure) {
    await logOutcome(actor.userId, targetId, attemptId, "FAILED", { code: failure });
    return { ok: false, code: failure };
  }
  const outcomeLogged = await logOutcome(actor.userId, targetId, attemptId, "SUCCEEDED", {});
  return { ok: true, outcomeLogged };
}
