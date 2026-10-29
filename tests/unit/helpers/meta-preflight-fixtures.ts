/**
 * Shared fixtures for tests that drive launchChannelCampaignAction through the
 * PR #36 Meta preflight. A tenant "t1" with product "p1" that is fully ready
 * to launch; tests mutate the returned object to break one prerequisite.
 */
export interface PreflightFixtures {
  approvals: { status: string; created_at: string; context?: unknown }[];
  approvalError: boolean;
  product: { id: string; website_url: string | null } | null;
  brand: { website_url: string | null } | null;
  media: { id: string; tenant_id: string; product_id: string; storage_path: string; media_type: string; position: number }[];
  /** Objects Supabase Storage reports for the listed directory. */
  storageObjects: { name: string; metadata: { mimetype?: string; size?: number } | null }[];
  storageListCalls: { directory: string; search: unknown }[];
  /** Tables read, in order, so tests can assert nothing else was touched. */
  reads: string[];
}

export function makePreflightFixtures(): PreflightFixtures {
  return {
    approvals: [{ status: "APPROVED", created_at: "2026-10-01T00:00:00Z" }],
    approvalError: false,
    product: { id: "p1", website_url: "https://toko-saya.co.id/produk" },
    brand: { website_url: null },
    media: [
      { id: "m1", tenant_id: "t1", product_id: "p1", storage_path: "t1/p1/1700-foto.jpg", media_type: "IMAGE", position: 0 },
    ],
    storageObjects: [{ name: "1700-foto.jpg", metadata: { mimetype: "image/jpeg", size: 120_000 } }],
    storageListCalls: [],
    reads: [],
  };
}

/** A chainable, awaitable query builder that always resolves to `result`. */
export function chain(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "gte", "in"]) {
    builder[method] = () => builder;
  }
  builder.maybeSingle = async () => result;
  builder.single = async () => result;
  builder.then = (resolve: (value: unknown) => unknown) => resolve(result);
  return builder;
}

/**
 * Approval rows that do not declare a `context` at all model "an approval submitted with the landing URL this
 * fixture currently has": they get a legacy_url snapshot of that URL. A row that DOES declare `context`
 * (including `null` or `{}`) is returned verbatim, so tests of missing / old / changed snapshots stay exact.
 */
function withDefaultSnapshots(fx: PreflightFixtures) {
  const productUrl = fx.product?.website_url?.trim();
  const link = productUrl ? fx.product?.website_url : (fx.brand?.website_url ?? null);
  const snapshot = link
    ? { version: 1, kind: "legacy_url", link }
    : { version: 1, kind: "legacy_unresolved" };
  return fx.approvals.map((row) =>
    "context" in row ? row : { ...row, context: { destination_snapshot: snapshot } },
  );
}

/** Returns a builder for the tables the preflight reads, or null for any other table. */
export function preflightTable(table: string, fx: PreflightFixtures) {
  switch (table) {
    case "prompter_approvals":
      fx.reads.push(table);
      return chain(
        fx.approvalError ? { data: null, error: { code: "XX000" } } : { data: withDefaultSnapshots(fx), error: null },
      );
    case "prompter_products":
      fx.reads.push(table);
      return chain({ data: fx.product, error: null });
    case "prompter_brand_profiles":
      fx.reads.push(table);
      return chain({ data: fx.brand, error: null });
    case "prompter_product_media":
      fx.reads.push(table);
      return chain({ data: fx.media, error: null });
    default:
      return null;
  }
}

export function makeAdminStorage(fx: PreflightFixtures) {
  return {
    from: () => ({
      list: async (directory: string, options: { search?: unknown }) => {
        fx.storageListCalls.push({ directory, search: options?.search });
        return { data: fx.storageObjects, error: null };
      },
    }),
  };
}

/** Wraps the real objective contracts, flipping only BRAND_AWARENESS to verified for action-level tests. */
export async function verifiedContracts(
  importOriginal: () => Promise<typeof import("@/lib/campaigns/meta-objective-contracts")>,
) {
  const real = await importOriginal();
  return {
    ...real,
    META_OBJECTIVE_CONTRACTS: {
      ...real.META_OBJECTIVE_CONTRACTS,
      BRAND_AWARENESS: { ...real.META_OBJECTIVE_CONTRACTS.BRAND_AWARENESS, verified: true },
    },
  };
}
