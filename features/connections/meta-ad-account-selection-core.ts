import { ConnectorConfigError } from "@/lib/connectors/types";
import {
  accountStatusLabel,
  classifyGraphFailure,
  evaluateMetaReadiness,
  unavailableReasonMessage,
  type ReadinessState,
} from "@/lib/connectors/meta-readiness";
import type { MetaAdAccountListing } from "@/lib/connectors/meta-connector";

/**
 * F-2b — listing and selecting the Meta ad account, with every side effect
 * injected (no Next.js, Supabase, cipher or network imports), exactly like
 * `meta-readiness-core.ts`. The real wiring is in features/connections/actions.ts.
 *
 * Security contract:
 *  - Owner-only, checked before anything is read.
 *  - Everything is scoped by the session's tenant; the client sends nothing but
 *    an ad-account id, and that id is accepted ONLY if it appears in the list
 *    Meta returns right now for THIS tenant's own token (anti-IDOR, anti-stale).
 *  - Selecting an account only stores which account LINOE reads. It never
 *    creates or changes a campaign, budget or payment, and it never touches the
 *    External Budget Safety Gate.
 *  - Nothing returned carries a token, a funding-source id or provider text.
 */

export interface SelectionConnectionRow {
  id: string;
  status: string;
  external_account_id: string | null;
  expires_at: string | null;
  last_refreshed_at: string | null;
}

export type PersistSelectionOutcome = { ok: true } | { ok: false; reason: "CONFLICT" | "ERROR" };

export interface MetaAdAccountSelectionDeps {
  /** Scoped by `tenantId` and platform META. `ok: false` = could not read. */
  loadConnection(tenantId: string): Promise<{ ok: true; connection: SelectionConnectionRow | null } | { ok: false }>;
  /** Scoped by BOTH `tenantId` and `connectedAccountId`. */
  loadEncryptedToken(
    tenantId: string,
    connectedAccountId: string,
  ): Promise<{ ok: true; encrypted: string | null } | { ok: false }>;
  decrypt(blob: string): string;
  connector: {
    isConfigured(): boolean;
    listAdAccounts(accessToken: string): Promise<MetaAdAccountListing>;
  };
  /** Has this Owner confirmed the stored account since the latest (re)connect? */
  isSelectionConfirmed(tenantId: string, connection: SelectionConnectionRow): Promise<{ ok: true; confirmed: boolean } | { ok: false }>;
  /** Does this tenant already have ads created on Meta (an `external_campaign_id`)? */
  hasMetaCampaigns(tenantId: string): Promise<{ ok: true; has: boolean } | { ok: false }>;
  /**
   * Stores the choice. Must (1) update the connection row only when it still
   * belongs to `tenantId`, is CONNECTED and still has `expectedLastRefreshedAt`
   * (a reconnect in between => CONFLICT), and (2) record the confirmation.
   */
  persistSelection(input: {
    tenantId: string;
    userId: string;
    connectionId: string;
    expectedLastRefreshedAt: string;
    adAccountId: string;
    adAccountName: string;
    previousAdAccountId: string | null;
  }): Promise<PersistSelectionOutcome>;
  now(): Date;
  /** Receives a stage name and the thrown value; must log only structured, non-sensitive fields. */
  logFailure(stage: string, err?: unknown): void;
}

export interface AdAccountOption {
  /** Meta ad-account id (`act_…`). Not a secret; it is what the Owner sees in Ads Manager. */
  id: string;
  name: string;
  currency: string | null;
  statusLabel: string;
  /** Per-account readiness from the same evaluator as the readiness check. */
  readiness: ReadinessState;
  /** Indonesian notes for every check that did not pass (empty when READY). */
  notes: string[];
  /** This is the account LINOE currently has stored. */
  isCurrent: boolean;
}

export type MetaAdAccountListResult =
  | { error: string; accounts: null }
  | {
      error: null;
      accounts: AdAccountOption[];
      truncated: boolean;
      /** The Owner confirmed the stored account since the latest (re)connect. */
      selectionConfirmed: boolean;
      /** The stored account is not among the accounts this connection can access. */
      currentMissing: boolean;
    };

export type MetaAdAccountSelectResult = { error: string; selected: null } | { error: null; selected: { id: string; name: string } };

const OWNER_ONLY = "Hanya Owner yang dapat memilih akun iklan.";
const NOT_CONNECTED = "Akun Meta belum terhubung. Hubungkan akun di halaman Connections terlebih dahulu.";
const UNREADABLE = "Status koneksi tidak dapat dibaca saat ini. Coba lagi nanti.";
const CREDENTIALS = "Kredensial koneksi tidak dapat dibaca. Coba sambungkan ulang akun Meta.";
const EXPIRED = unavailableReasonMessage("TOKEN_EXPIRED");
const NOT_CONFIGURED = unavailableReasonMessage("NOT_CONFIGURED");

/** Graph ad-account ids look like `act_<digits>`; anything else never reaches a comparison or a write. */
const AD_ACCOUNT_ID_PATTERN = /^act_\d{1,32}$/;

type Prepared =
  | { ok: false; error: string }
  | { ok: true; connection: SelectionConnectionRow; listing: MetaAdAccountListing };

/** Owner/connection/expiry/credentials checks, then one live read-only list. Shared by list and select. */
async function prepare(
  session: { tenantId: string; role: string },
  deps: MetaAdAccountSelectionDeps,
): Promise<Prepared> {
  if (session.role !== "owner") return { ok: false, error: OWNER_ONLY };
  if (!deps.connector.isConfigured()) return { ok: false, error: NOT_CONFIGURED };

  const read = await deps.loadConnection(session.tenantId);
  if (!read.ok) {
    deps.logFailure("load_connection");
    return { ok: false, error: UNREADABLE };
  }
  const connection = read.connection;
  if (!connection || connection.status !== "CONNECTED") return { ok: false, error: NOT_CONNECTED };

  if (connection.expires_at) {
    const expiresAt = new Date(connection.expires_at);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= deps.now().getTime()) {
      return { ok: false, error: EXPIRED };
    }
  }

  const tokenRead = await deps.loadEncryptedToken(session.tenantId, connection.id);
  if (!tokenRead.ok) {
    deps.logFailure("load_credentials");
    return { ok: false, error: UNREADABLE };
  }
  if (!tokenRead.encrypted) return { ok: false, error: CREDENTIALS };

  let accessToken: string;
  try {
    accessToken = deps.decrypt(tokenRead.encrypted);
  } catch (err) {
    deps.logFailure("decrypt", err);
    return { ok: false, error: CREDENTIALS };
  }

  try {
    const listing = await deps.connector.listAdAccounts(accessToken);
    return { ok: true, connection, listing };
  } catch (err) {
    deps.logFailure("graph_list", err);
    if (err instanceof ConnectorConfigError) return { ok: false, error: NOT_CONFIGURED };
    return { ok: false, error: unavailableReasonMessage(classifyGraphFailure(err)) };
  }
}

function bareId(value: string): string {
  return value.startsWith("act_") ? value.slice(4) : value;
}

export async function listMetaAdAccounts(
  session: { tenantId: string; role: string },
  deps: MetaAdAccountSelectionDeps,
): Promise<MetaAdAccountListResult> {
  const prepared = await prepare(session, deps);
  if (!prepared.ok) return { error: prepared.error, accounts: null };

  const { connection, listing } = prepared;
  const storedBare = connection.external_account_id ? bareId(connection.external_account_id) : null;

  // Failure to read the confirmation marker is treated as "not confirmed".
  const confirmation = await deps.isSelectionConfirmed(session.tenantId, connection);
  if (!confirmation.ok) deps.logFailure("read_confirmation");
  const selectionConfirmed = confirmation.ok && confirmation.confirmed;

  const now = deps.now();
  const accounts: AdAccountOption[] = listing.accounts.map((item) => {
    const readiness = evaluateMetaReadiness(item.snapshot, now);
    return {
      id: item.id,
      name: item.name,
      currency: item.snapshot.currency,
      statusLabel: accountStatusLabel(item.snapshot.accountStatus),
      readiness: readiness.state,
      notes: readiness.checks.filter((c) => c.status !== "PASS").map((c) => c.detail),
      isCurrent: storedBare !== null && bareId(item.id) === storedBare,
    };
  });

  return {
    error: null,
    accounts,
    truncated: listing.truncated,
    selectionConfirmed,
    currentMissing: storedBare !== null && !accounts.some((a) => a.isCurrent),
  };
}

export async function selectMetaAdAccount(
  session: { tenantId: string; userId: string; role: string },
  adAccountId: unknown,
  deps: MetaAdAccountSelectionDeps,
): Promise<MetaAdAccountSelectResult> {
  const fail = (error: string): MetaAdAccountSelectResult => ({ error, selected: null });

  if (session.role !== "owner") return fail(OWNER_ONLY);
  if (typeof adAccountId !== "string" || !AD_ACCOUNT_ID_PATTERN.test(adAccountId)) {
    return fail("Akun iklan tidak valid.");
  }

  const prepared = await prepare(session, deps);
  if (!prepared.ok) return fail(prepared.error);
  const { connection, listing } = prepared;

  // The id must be one of the accounts this tenant's OWN token can access right
  // now. A tampered, stale or other-tenant id is never in that list.
  const chosen = listing.accounts.find((a) => a.id === adAccountId);
  if (!chosen) {
    return fail("Akun iklan tidak ditemukan atau sudah tidak dapat diakses. Muat ulang daftar akun lalu coba lagi.");
  }

  // A reconnect stamps `last_refreshed_at`; the write below is only accepted
  // while that value is unchanged, so a choice made against an older token
  // can never land on a newer connection.
  if (!connection.last_refreshed_at) {
    return fail("Koneksi Meta belum lengkap. Sambungkan ulang akun Meta lalu coba lagi.");
  }

  const previous = connection.external_account_id;
  const changes = previous === null || bareId(previous) !== bareId(chosen.id);
  if (changes) {
    // Changing the account would orphan ads already created on the old one
    // (pause / insights use the stored account). Refuse, and refuse when unsure.
    const campaigns = await deps.hasMetaCampaigns(session.tenantId);
    if (!campaigns.ok) {
      deps.logFailure("check_campaigns");
      return fail(UNREADABLE);
    }
    if (campaigns.has) {
      return fail(
        "Sudah ada iklan yang dibuat di akun iklan saat ini, jadi akun tidak bisa diganti dari sini. Hubungi admin LINOE.",
      );
    }
  }

  const outcome = await deps.persistSelection({
    tenantId: session.tenantId,
    userId: session.userId,
    connectionId: connection.id,
    expectedLastRefreshedAt: connection.last_refreshed_at,
    adAccountId: chosen.id,
    adAccountName: chosen.name,
    previousAdAccountId: previous,
  });
  if (!outcome.ok) {
    deps.logFailure(outcome.reason === "CONFLICT" ? "persist_conflict" : "persist_error");
    return fail(
      outcome.reason === "CONFLICT"
        ? "Koneksi Meta berubah saat Anda memilih (mungkin disambungkan ulang). Muat ulang daftar akun lalu pilih lagi."
        : "Pilihan akun iklan gagal disimpan. Coba lagi.",
    );
  }

  return { error: null, selected: { id: chosen.id, name: chosen.name } };
}
