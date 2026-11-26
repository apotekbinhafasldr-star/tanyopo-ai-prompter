import { PRIVACY_NOTICE_VERSION, TERMS_VERSION } from "@/features/legal/legal-versions";
import type { ConsentRpcClient } from "@/lib/consent/rpc";

export interface SignupLegalDeps {
  getClient?: () => Promise<ConsentRpcClient | null>;
  logFailure?: (stage: string) => void;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 3000;

async function defaultGetClient(): Promise<ConsentRpcClient | null> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient() as unknown as ConsentRpcClient | null;
}

function defaultLog(stage: string): void {
  // Hanya nama tahap tetap. Tanpa email, nama, user id, atau pesan galat.
  console.error("[consent] signup_legal_record_failed", { stage });
}

/**
 * Mencatat penerimaan Terms (ACCEPTED) dan penyampaian Privacy Notice (DELIVERED) sebagai DUA catatan terpisah, versi dari konstanta
 * kode dan waktu dari server database. FAIL-OPEN: tidak pernah melempar dan tidak memblokir pendaftaran; kegagalan hanya dicatat
 * di log tanpa data pribadi. Dipanggil hanya sesudah signUp() mengembalikan id pengguna BARU.
 */
export async function recordSignupLegal(userId: string, deps: SignupLegalDeps = {}): Promise<boolean> {
  const log = deps.logFailure ?? defaultLog;
  try {
    const client = await (deps.getClient ?? defaultGetClient)();
    if (!client) {
      log("no_client");
      return false;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"TIMEOUT">((resolve) => {
      timer = setTimeout(() => resolve("TIMEOUT"), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    });
    const result = await Promise.race([
      Promise.resolve(
        client.rpc("fn_prompter_record_signup_legal", {
          p_user_id: userId,
          p_terms_version: TERMS_VERSION,
          p_privacy_version: PRIVACY_NOTICE_VERSION,
        }),
      ),
      timeout,
    ]);
    if (timer) clearTimeout(timer);
    if (result === "TIMEOUT") {
      log("timeout");
      return false;
    }
    const { error } = result;
    if (error) {
      log("rpc_error");
      return false;
    }
    return true;
  } catch {
    log("exception");
    return false;
  }
}
