/**
 * Internal campaign preview (read-only). PURE: turns the stored campaign row
 * and its AI proposal into a tidy summary for the Owner. No network, no
 * database, no Meta call, and no rendering of an ad "as Meta would show it".
 *
 * The estimate is a COST estimate derived only from the budget the Owner set.
 * It never estimates reach, clicks, conversions or sales: LINOE has no
 * structured audience or conversion model to base such numbers on.
 */

const META_CHANNELS: readonly string[] = ["FACEBOOK", "INSTAGRAM"];

export interface InternalPreviewInput {
  aiProposal: unknown;
  audienceNotes: string | null | undefined;
  targetCity: string | null | undefined;
  targetRegion: string | null | undefined;
  targetCountry: string | null | undefined;
  targetLanguage: string | null | undefined;
  dailyBudget: number | null | undefined;
  totalBudget: number | null | undefined;
  currency: string | null | undefined;
  durationDays: number | null | undefined;
  /** Stored channel rows; their percentage wins over the proposal's. */
  channelShares: readonly { channel: string; percentage: number | null }[];
}

export interface InternalPreview {
  hasProposal: boolean;
  strategy: {
    positioning: string | null;
    marketingAngle: string | null;
    valueProposition: string | null;
    customerPain: string | null;
  };
  creative: {
    headline: string | null;
    hook: string | null;
    primaryText: string | null;
    cta: string | null;
    concept: string | null;
  };
  audience: {
    summary: string | null;
    notes: string | null;
    location: string | null;
    language: string | null;
  };
  budget: {
    dailyBudget: number | null;
    totalBudget: number | null;
    currency: string;
    /** Combined Facebook + Instagram share in percent; null when not known. */
    metaSharePercent: number | null;
    /** Whole-unit daily amount for that share (rounded down); null when not computable. */
    metaDailyAmount: number | null;
  };
  estimate: {
    durationDays: number | null;
    /** metaDailyAmount x durationDays; null unless both are valid. */
    metaCostForDuration: number | null;
  };
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const positiveInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
const validPercent = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;

function metaShare(
  channelShares: InternalPreviewInput["channelShares"],
  proposal: Record<string, unknown> | null,
): number | null {
  const fromRows = channelShares.filter((c) => META_CHANNELS.includes(c.channel));
  if (fromRows.length > 0) {
    if (!fromRows.every((c) => validPercent(c.percentage))) return null;
    return clampPercent(fromRows.reduce((sum, c) => sum + (c.percentage as number), 0));
  }
  const allocation = proposal?.budget_allocation;
  if (!Array.isArray(allocation)) return null;
  let sum = 0;
  let found = false;
  for (const entry of allocation) {
    const row = record(entry);
    if (!row || typeof row.channel !== "string" || !META_CHANNELS.includes(row.channel)) continue;
    if (!validPercent(row.percentage)) return null;
    sum += row.percentage;
    found = true;
  }
  return found ? clampPercent(sum) : null;
}

const clampPercent = (n: number) => Math.min(100, Math.max(0, n));

export function buildInternalPreview(input: InternalPreviewInput): InternalPreview {
  const proposal = record(input.aiProposal);
  const currency = text(input.currency) ?? "IDR";
  const daily = positiveInt(input.dailyBudget) ? input.dailyBudget : null;
  const total = positiveInt(input.totalBudget) ? input.totalBudget : null;
  const share = metaShare(input.channelShares, proposal);

  const metaDailyAmount = daily !== null && share !== null ? Math.floor((daily * share) / 100) : null;
  const durationDays = positiveInt(input.durationDays) ? input.durationDays : null;
  const cost = metaDailyAmount !== null && metaDailyAmount > 0 && durationDays !== null ? metaDailyAmount * durationDays : null;

  const location = [input.targetCity, input.targetRegion, input.targetCountry]
    .map(text)
    .filter((v): v is string => v !== null)
    .join(", ");
  const lang = text(input.targetLanguage);

  return {
    hasProposal: proposal !== null,
    strategy: {
      positioning: text(proposal?.positioning),
      marketingAngle: text(proposal?.marketing_angle),
      valueProposition: text(proposal?.value_proposition),
      customerPain: text(proposal?.customer_pain),
    },
    creative: {
      headline: text(proposal?.headline),
      hook: text(proposal?.hook),
      primaryText: text(proposal?.primary_text),
      cta: text(proposal?.cta),
      concept: text(proposal?.creative_concept),
    },
    audience: {
      summary: text(proposal?.audience_summary),
      notes: text(input.audienceNotes),
      location: location.length > 0 ? location : null,
      language: lang === "id" ? "Indonesia" : lang === "en" ? "English" : lang,
    },
    budget: {
      dailyBudget: daily,
      totalBudget: total,
      currency,
      metaSharePercent: share,
      metaDailyAmount,
    },
    estimate: {
      durationDays,
      metaCostForDuration: cost !== null && Number.isSafeInteger(cost) ? cost : null,
    },
  };
}
