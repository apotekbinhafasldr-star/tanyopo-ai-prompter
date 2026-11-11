import {
  isGroundedText,
  removeOverstatedSentences,
  type StoredAiSearchReadiness,
  type VerifiedFact,
} from "@/lib/seo/ai-search-readiness";
import { serializeJsonLd } from "@/lib/seo/json-ld";

/**
 * Structured-data export for the TENANT's own pages (not LINOE's landing page).
 *
 * Built deterministically from data that already exists: the answered questions and verified facts stored by
 * AI Search Readiness. No new AI call, no network call, nothing is written anywhere; the owner copies the result
 * and pastes it into their own site. Rules:
 *  - FAQPage contains only questions whose answer survived the grounding check (never a null/placeholder answer);
 *    answers are re-checked against the stored facts here, so older stored rows cannot leak an ungrounded claim.
 *  - Product contains only name/description/category and, when the owner entered a price, a price + currency.
 *    No availability, rating, review, award, shipping or certification is ever invented.
 *  - Facts that describe LINOE itself (key prefix `linoe_`) are never exported: they carry planned/target status.
 *  - Google no longer shows FAQ rich results (official documentation, 2026-06-15), so FAQPage here is plain
 *    schema.org data with no promise of any search appearance.
 */
export const MAX_EXPORT_FAQ_ITEMS = 10;
const MAX_QUESTION_CHARS = 200;
const MAX_ANSWER_CHARS = 600;

export interface FaqJsonLd {
  "@context": "https://schema.org";
  "@type": "FAQPage";
  mainEntity: { "@type": "Question"; name: string; acceptedAnswer: { "@type": "Answer"; text: string } }[];
}

export interface ProductJsonLd {
  "@context": "https://schema.org";
  "@type": "Product";
  name: string;
  description?: string;
  category?: string;
  offers?: { "@type": "Offer"; price: string; priceCurrency: string };
}

const isTenantFact = (f: VerifiedFact) => !f.key.startsWith("linoe_");
const oneLine = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max).trimEnd();

export function buildCustomerFaqJsonLd(data: StoredAiSearchReadiness): FaqJsonLd | null {
  const facts = data.verified_facts;
  // A LINOE self-entity row (planned/target facts) is not exportable as a tenant FAQ.
  if (!facts.every(isTenantFact)) return null;
  const factsText = facts.map((f) => f.value).join(" \n ");
  const items: FaqJsonLd["mainEntity"] = [];
  for (const q of data.customer_questions) {
    if (items.length >= MAX_EXPORT_FAQ_ITEMS) break;
    if (typeof q?.question !== "string" || typeof q?.short_answer !== "string") continue;
    const question = oneLine(q.question, MAX_QUESTION_CHARS);
    const answer = oneLine(q.short_answer, MAX_ANSWER_CHARS);
    if (!question || !answer) continue;
    if (facts.length === 0 || !isGroundedText(answer, factsText)) continue;
    if (removeOverstatedSentences(answer, facts).removed > 0) continue;
    items.push({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } });
  }
  return items.length > 0 ? { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items } : null;
}

/** "IDR 55000" (as stored by buildVerifiedFacts) -> { currency, amount }, or null when it is not a clean price. */
function parsePriceFact(value: string): { currency: string; amount: string } | null {
  const m = /^([A-Z]{3}) (\d+(?:\.\d{1,2})?)$/.exec(value.trim());
  return m ? { currency: m[1], amount: m[2] } : null;
}

export function buildCustomerProductJsonLd(data: StoredAiSearchReadiness): ProductJsonLd | null {
  const facts = data.verified_facts;
  if (!facts.every(isTenantFact)) return null;
  const get = (key: string) => facts.find((f) => f.key === key)?.value;
  const name = get("product_name");
  if (!name) return null;
  const out: ProductJsonLd = { "@context": "https://schema.org", "@type": "Product", name: oneLine(name, 200) };
  const description = get("product_description");
  if (description) out.description = oneLine(description, 500);
  const category = get("product_category");
  if (category) out.category = oneLine(category, 100);
  const priceFact = get("product_price");
  const price = priceFact ? parsePriceFact(priceFact) : null;
  if (price && Number(price.amount) > 0) {
    out.offers = { "@type": "Offer", price: price.amount, priceCurrency: price.currency };
  }
  return out;
}

export interface CustomerJsonLdExport {
  faq: { json: string; snippet: string; count: number } | null;
  product: { json: string; snippet: string } | null;
}

/** `<`, `>` and `&` are escaped by serializeJsonLd (still valid JSON), so the snippet is safe inside a <script> tag. */
const toScriptTag = (json: string) => `<script type="application/ld+json">\n${json}\n</script>`;

export function buildCustomerJsonLdExport(data: StoredAiSearchReadiness): CustomerJsonLdExport {
  const faq = buildCustomerFaqJsonLd(data);
  const product = buildCustomerProductJsonLd(data);
  const faqJson = faq ? serializeJsonLd(faq, 2) : null;
  const productJson = product ? serializeJsonLd(product, 2) : null;
  return {
    faq: faq && faqJson ? { json: faqJson, snippet: toScriptTag(faqJson), count: faq.mainEntity.length } : null,
    product: product && productJson ? { json: productJson, snippet: toScriptTag(productJson) } : null,
  };
}
