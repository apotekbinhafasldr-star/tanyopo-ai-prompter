import { add, isNegative, isPositive, min, mulBps, sub, zero, type Money } from "@/lib/finance/money";

/**
 * Fiscal reconciliation (rekonsiliasi fiskal) SUPPORT data for the accountant.
 *
 * Hard rules:
 *  - no tax rate is ever assumed: the corporate rate comes from a config a human verified;
 *  - a fiscal adjustment / loss carry-forward counts only when it is verified (who + when);
 *    unverified ones are listed as pending and excluded;
 *  - the LINOE figures are a SEGMENT. They are never presented as the whole PT's SPT: the
 *    entity-level view stays INCOMPLETE until every other activity is supplied AND verified.
 *  - special facilities / final-tax regimes are not modelled.
 */
export type AdjustmentDirection = "POSITIVE" | "NEGATIVE";
export type AdjustmentNature = "PERMANENT" | "TEMPORARY";

export interface Verification {
  readonly verifiedBy: string | null;
  readonly verifiedAt: string | null;
}
export interface FiscalAdjustment extends Verification {
  readonly id: string;
  readonly description: string;
  readonly direction: AdjustmentDirection;
  readonly nature: AdjustmentNature;
  /** Always positive; the direction carries the sign. */
  readonly amount: Money;
  readonly evidenceRef: string | null;
}
export interface CorporateTaxConfig extends Verification {
  /** Basis points. null = not configured. */
  readonly rateBps: number | null;
}
export interface LossCarryforward extends Verification {
  readonly amount: Money;
  readonly note: string | null;
}
export interface OtherActivity extends Verification {
  readonly name: string;
  /** Fiscal profit (loss negative) of that activity for the same year, before loss carry-forward. */
  readonly fiscalProfit: Money;
}

export const isVerified = (v: Verification): boolean => Boolean(v.verifiedBy?.trim() && v.verifiedAt?.trim());

export type TaxAmount =
  | { readonly status: "COMPUTED"; readonly amount: Money }
  | { readonly status: "NOT_CONFIGURED"; readonly reason: string };

export interface FiscalView {
  readonly scope: "SEGMEN_LINOE" | "ENTITAS_PT";
  readonly commercialProfit: Money;
  readonly positiveAdjustments: Money;
  readonly negativeAdjustments: Money;
  readonly fiscalProfitBeforeLoss: Money;
  readonly lossUsed: Money;
  readonly taxableIncome: Money;
  /** Unused loss that carries on (informational, verified input only). */
  readonly lossRemaining: Money;
  readonly tax: TaxAmount;
}
export interface FiscalReconciliation {
  readonly year: string;
  readonly currency: string;
  readonly appliedAdjustments: readonly FiscalAdjustment[];
  readonly pendingAdjustments: readonly FiscalAdjustment[];
  readonly lossCarryforwardStatus: "NONE" | "VERIFIED" | "PENDING";
  readonly segment: FiscalView;
  readonly entity:
    | { readonly status: "COMPLETE"; readonly view: FiscalView; readonly activities: readonly string[] }
    | { readonly status: "INCOMPLETE"; readonly reason: string };
  readonly warnings: readonly string[];
}

function taxOn(taxable: Money, config: CorporateTaxConfig): TaxAmount {
  if (!isVerified(config)) return { status: "NOT_CONFIGURED", reason: "Tarif PPh badan belum diverifikasi akuntan" };
  if (config.rateBps === null || !Number.isInteger(config.rateBps) || config.rateBps <= 0 || config.rateBps > 10000) {
    return { status: "NOT_CONFIGURED", reason: "Tarif PPh badan belum diisi" };
  }
  return { status: "COMPUTED", amount: mulBps(taxable, config.rateBps) };
}

function view(
  scope: FiscalView["scope"],
  commercial: Money,
  pos: Money,
  neg: Money,
  fiscalOverride: Money | null,
  loss: Money,
  config: CorporateTaxConfig,
): FiscalView {
  const cur = commercial.currency;
  const fiscal = fiscalOverride ?? sub(add(commercial, pos), neg);
  const lossUsed = isPositive(fiscal) ? min(loss, fiscal) : zero(cur);
  const taxable = isPositive(fiscal) ? sub(fiscal, lossUsed) : zero(cur);
  return {
    scope,
    commercialProfit: commercial,
    positiveAdjustments: pos,
    negativeAdjustments: neg,
    fiscalProfitBeforeLoss: fiscal,
    lossUsed,
    taxableIncome: taxable,
    lossRemaining: sub(loss, lossUsed),
    tax: taxOn(taxable, config),
  };
}

export function reconcileFiscal(input: {
  year: string;
  commercialProfit: Money;
  adjustments: readonly FiscalAdjustment[];
  lossCarryforward: LossCarryforward | null;
  config: CorporateTaxConfig;
  otherActivities?: readonly OtherActivity[];
}): FiscalReconciliation {
  const cur = input.commercialProfit.currency;
  const warnings: string[] = ["Data pendukung untuk akuntan; bukan SPT dan bukan perhitungan pajak final."];
  const applied: FiscalAdjustment[] = [];
  const pending: FiscalAdjustment[] = [];
  let pos = zero(cur);
  let neg = zero(cur);
  for (const a of input.adjustments) {
    if (!isPositive(a.amount)) throw new Error(`Fiscal adjustment ${a.id} must have a positive amount`);
    if (!isVerified(a)) {
      pending.push(a);
      continue;
    }
    applied.push(a);
    if (a.direction === "POSITIVE") pos = add(pos, a.amount);
    else neg = add(neg, a.amount);
  }
  if (pending.length > 0) warnings.push(`${pending.length} penyesuaian fiskal belum diverifikasi dan tidak dihitung.`);

  let lossStatus: FiscalReconciliation["lossCarryforwardStatus"] = "NONE";
  let loss = zero(cur);
  if (input.lossCarryforward) {
    if (isNegative(input.lossCarryforward.amount)) throw new Error("Loss carry-forward cannot be negative");
    if (isVerified(input.lossCarryforward)) {
      lossStatus = "VERIFIED";
      loss = input.lossCarryforward.amount;
    } else {
      lossStatus = "PENDING";
      warnings.push("Kompensasi kerugian belum diverifikasi dan tidak dihitung.");
    }
  }
  if (!isVerified(input.config)) warnings.push("Tarif PPh badan belum diverifikasi: pajak tidak dihitung.");

  const segment = view("SEGMEN_LINOE", input.commercialProfit, pos, neg, null, loss, input.config);
  warnings.push("Angka ini hanya segmen LINOE, bukan SPT seluruh PT Tanyopo.");

  const others = input.otherActivities ?? [];
  let entity: FiscalReconciliation["entity"];
  if (others.length === 0) {
    entity = { status: "INCOMPLETE", reason: "Aktivitas PT lain (mis. PUBLOE, Apotek) belum dimasukkan — bukan SPT PT." };
  } else if (others.some((o) => !isVerified(o))) {
    entity = { status: "INCOMPLETE", reason: "Ada aktivitas PT lain yang belum diverifikasi — bukan SPT PT." };
  } else {
    let combined = segment.fiscalProfitBeforeLoss;
    for (const o of others) combined = add(combined, o.fiscalProfit);
    entity = {
      status: "COMPLETE",
      activities: ["LINOE", ...others.map((o) => o.name)],
      view: view("ENTITAS_PT", input.commercialProfit, pos, neg, combined, loss, input.config),
    };
  }
  return {
    year: input.year,
    currency: cur,
    appliedAdjustments: applied,
    pendingAdjustments: pending,
    lossCarryforwardStatus: lossStatus,
    segment,
    entity,
    warnings,
  };
}

export type TaxPaymentKind = "PPH21" | "PPH22" | "PPH23" | "PPH25" | "PPH29" | "PPN" | "LAINNYA";
export interface TaxPaymentRecord {
  readonly id: string;
  readonly kind: TaxPaymentKind;
  readonly date: string;
  readonly description: string;
  readonly amount: Money;
  /** Withholding-slip number or payment proof (NTPN). Required: no proof, no record. */
  readonly evidenceRef: string;
}

export function taxPaymentRegister(records: readonly TaxPaymentRecord[], currency: string): {
  rows: readonly TaxPaymentRecord[];
  byKind: Record<string, Money>;
  total: Money;
  provided: boolean;
} {
  const byKind: Record<string, Money> = {};
  let total = zero(currency);
  const seen = new Set<string>();
  for (const r of records) {
    if (!r.evidenceRef.trim()) throw new Error(`Tax record ${r.id} needs an evidence reference`);
    if (seen.has(r.id)) throw new Error(`Duplicate tax record ${r.id}`);
    seen.add(r.id);
    byKind[r.kind] = add(byKind[r.kind] ?? zero(currency), r.amount);
    total = add(total, r.amount);
  }
  return { rows: records, byKind, total, provided: records.length > 0 };
}
