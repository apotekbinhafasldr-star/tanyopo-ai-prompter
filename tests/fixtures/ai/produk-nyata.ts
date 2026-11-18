/**
 * SCENARIO B — REAL product with verified test data.
 *
 * NOT FILLED IN ON PURPOSE. The Founder asked for "fixture atau data yang
 * disetujui" and for no invented product facts. Until the Founder supplies (or
 * approves reading) one real product's data, `approved` stays false and the
 * scenario-B tests are skipped, not faked.
 *
 * To activate: set approved=true and fill `product` with facts copied from the
 * real product record, `source` (where they came from) and `approvedBy`.
 */
export interface RealProductFixture {
  readonly approved: boolean;
  readonly source: string | null;
  readonly approvedBy: string | null;
  readonly product: { readonly name: string; readonly knownFacts: string } | null;
}

export const REAL_PRODUCT_FIXTURE: RealProductFixture = {
  approved: false,
  source: null,
  approvedBy: null,
  product: null,
};
