import "server-only";

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyUmkmproServiceToken } from "@/lib/umkmpro/auth";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type AuthorizedContext = { admin: SupabaseClient<Database> };

/**
 * Shared auth + service-role-client gate for every
 * /api/v1/integrations/umkmpro/* route. Returns a ready-to-use admin
 * client on success, or the exact NextResponse the route should return
 * immediately (never falls through to business logic on failure).
 */
export function authorizeUmkmproRequest(
  request: Request,
): { ok: true; context: AuthorizedContext } | { ok: false; response: NextResponse } {
  const auth = verifyUmkmproServiceToken(request.headers.get("authorization"));
  if (!auth.ok && auth.reason === "NOT_CONFIGURED") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "NOT_CONFIGURED", message: "UMKMPRO_SERVICE_TOKEN belum dikonfigurasi." },
        { status: 501 },
      ),
    };
  }
  if (!auth.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }),
    };
  }

  const admin = createAdminClient();
  if (!admin) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "NOT_CONFIGURED", message: "SUPABASE_SECRET_KEY belum dikonfigurasi." },
        { status: 501 },
      ),
    };
  }

  return { ok: true, context: { admin } };
}

/** Confirms `tenantId` refers to a real, existing tenant before any write. */
export async function tenantExists(admin: SupabaseClient<Database>, tenantId: string): Promise<boolean> {
  const { data } = await admin.from("tenants").select("id").eq("id", tenantId).maybeSingle();
  return !!data;
}
