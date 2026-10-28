import { ConnectorConfigError } from "@/lib/connectors/types";
import {
  classifyGraphFailure,
  evaluateMetaReadiness,
  unavailableMetaReadiness,
  type MetaReadinessResult,
} from "@/lib/connectors/meta-readiness";
import type { MetaReadinessLookup } from "@/lib/connectors/meta-connector";

/**
 * F-2a — orchestration of the Meta ad-account readiness check, with every
 * side effect injected. This file imports no Next.js, Supabase, cipher or
 * network code: the real wiring lives in `checkMetaAdAccountReadinessAction`
 * (features/connections/actions.ts), and the tests drive this function with
 * fakes. That is what makes tenant scoping, owner-only access, token handling
 * and "never READY on uncertainty" verifiable without a live Meta account.
 *
 * Contract:
 *  - READ-ONLY. Nothing here writes to the database or to Meta.
 *  - The returned value is sanitised: it never contains an access token, an ad
 *    account id, a funding-source id, or provider error text.
 *  - Every path that cannot produce a full, positive answer returns UNKNOWN
 *    (or NOT_READY for a definite Meta-reported problem), never READY.
 */

export interface ReadinessConnectionRow {
  id: string;
  status: string;
  external_account_id: string | null;
  expires_at: string | null;
  /** F-2b: set at every (re)connect; bounds how old an Owner's account confirmation may be. */
  last_refreshed_at?: string | null;
}

export interface MetaReadinessDeps {
  /** Must be scoped by `tenantId` (and platform META). `ok: false` = could not read. */
  loadConnection(tenantId: string): Promise<{ ok: true; connection: ReadinessConnectionRow | null } | { ok: false }>;
  /** Must be scoped by BOTH `tenantId` and `connectedAccountId`. `ok: false` = could not read. */
  loadEncryptedToken(
    tenantId: string,
    connectedAccountId: string,
  ): Promise<{ ok: true; encrypted: string | null } | { ok: false }>;
  decrypt(blob: string): string;
  connector: {
    isConfigured(): boolean;
    getAccountReadinessSnapshot(
      accessToken: string,
      expectedAdAccountId: string,
      options?: { selectionConfirmed?: boolean },
    ): Promise<MetaReadinessLookup>;
  };
  /**
   * F-2b (optional): has the Owner explicitly confirmed the stored ad account
   * since the latest (re)connect? Absent, failing or false => the F-2a rule
   * applies and more than one ad account is never resolved.
   */
  isSelectionConfirmed?(
    tenantId: string,
    connection: ReadinessConnectionRow,
  ): Promise<{ ok: true; confirmed: boolean } | { ok: false }>;
  now(): Date;
  /** Receives a stage name and the thrown value; the implementation must log only structured, non-sensitive fields. */
  logFailure(stage: string, err?: unknown): void;
}

export type MetaReadinessActionResult =
  | { error: string; result: null }
  | { error: null; result: MetaReadinessResult };

const OWNER_ONLY_MESSAGE = "Hanya Owner yang dapat memeriksa kesiapan akun iklan.";
const CONNECTION_UNREADABLE_MESSAGE =
  "Status koneksi tidak dapat dibaca saat ini, jadi kesiapan tidak diperiksa. Coba lagi nanti.";

export async function runMetaReadinessCheck(
  session: { tenantId: string; role: string },
  deps: MetaReadinessDeps,
): Promise<MetaReadinessActionResult> {
  if (session.role !== "owner") {
    return { error: OWNER_ONLY_MESSAGE, result: null };
  }

  const now = deps.now();
  const unavailable = (reason: Parameters<typeof unavailableMetaReadiness>[0]): MetaReadinessActionResult => ({
    error: null,
    result: unavailableMetaReadiness(reason, now),
  });

  if (!deps.connector.isConfigured()) return unavailable("NOT_CONFIGURED");

  const connectionRead = await deps.loadConnection(session.tenantId);
  if (!connectionRead.ok) {
    deps.logFailure("load_connection");
    return { error: CONNECTION_UNREADABLE_MESSAGE, result: null };
  }

  const connection = connectionRead.connection;
  if (!connection || connection.status !== "CONNECTED") return unavailable("NOT_CONNECTED");

  // Do not spend a Graph call on a token we already know has lapsed.
  if (connection.expires_at) {
    const expiresAt = new Date(connection.expires_at);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
      return unavailable("TOKEN_EXPIRED");
    }
  }

  if (!connection.external_account_id) return unavailable("NO_AD_ACCOUNT");

  const tokenRead = await deps.loadEncryptedToken(session.tenantId, connection.id);
  if (!tokenRead.ok) {
    deps.logFailure("load_credentials");
    return { error: CONNECTION_UNREADABLE_MESSAGE, result: null };
  }
  if (!tokenRead.encrypted) return unavailable("CREDENTIALS_UNAVAILABLE");

  let accessToken: string;
  try {
    accessToken = deps.decrypt(tokenRead.encrypted);
  } catch (err) {
    deps.logFailure("decrypt", err);
    return unavailable("CREDENTIALS_UNAVAILABLE");
  }

  let selectionConfirmed = false;
  if (deps.isSelectionConfirmed) {
    const confirmation = await deps.isSelectionConfirmed(session.tenantId, connection);
    if (confirmation.ok) selectionConfirmed = confirmation.confirmed;
    else deps.logFailure("read_confirmation");
  }

  let lookup: MetaReadinessLookup;
  try {
    lookup = await deps.connector.getAccountReadinessSnapshot(accessToken, connection.external_account_id, {
      selectionConfirmed,
    });
  } catch (err) {
    deps.logFailure("graph_lookup", err);
    if (err instanceof ConnectorConfigError) return unavailable("NOT_CONFIGURED");
    return unavailable(classifyGraphFailure(err));
  }

  switch (lookup.kind) {
    case "NONE":
      return unavailable("NO_AD_ACCOUNT");
    case "MULTIPLE":
      return unavailable("MULTIPLE_AD_ACCOUNTS");
    case "MISMATCH":
      return unavailable("AD_ACCOUNT_MISMATCH");
    case "OK": {
      // The connection (or the chosen account) may have changed while Meta was
      // being asked: the token above could even belong to a newer connection.
      // Re-read it and only report if it is exactly the one we evaluated.
      const after = await deps.loadConnection(session.tenantId);
      const same =
        after.ok &&
        after.connection !== null &&
        after.connection.id === connection.id &&
        after.connection.status === "CONNECTED" &&
        after.connection.external_account_id === connection.external_account_id &&
        (after.connection.last_refreshed_at ?? null) === (connection.last_refreshed_at ?? null);
      if (!same) {
        deps.logFailure("connection_changed");
        return unavailable("CONNECTION_CHANGED");
      }
      return { error: null, result: evaluateMetaReadiness(lookup.snapshot, now) };
    }
    default:
      // Exhaustiveness guard: an unexpected shape is never READY.
      return unavailable("PROVIDER_ERROR");
  }
}
