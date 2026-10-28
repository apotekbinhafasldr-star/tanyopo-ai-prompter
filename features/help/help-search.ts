import { HELP_CATEGORIES, type HelpArticle, type HelpCategoryId } from "@/features/help/help-content";

/**
 * Client-side Help Center search. Pure and synchronous: no network, no
 * storage, no AI. Every whitespace-separated word of the query must appear
 * (case- and accent-insensitive) in the article's question, answer or
 * category title, so "refund trial" narrows instead of widening.
 */

export type HelpCategoryFilter = HelpCategoryId | "semua";

export function normalizeHelpText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

const CATEGORY_TITLE = new Map<HelpCategoryId, string>(HELP_CATEGORIES.map((c) => [c.id, c.title]));

export function filterHelpArticles(
  articles: readonly HelpArticle[],
  query: string,
  category: HelpCategoryFilter,
): HelpArticle[] {
  const words = normalizeHelpText(query).split(/\s+/).filter(Boolean);
  return articles.filter((a) => {
    if (category !== "semua" && a.category !== category) return false;
    if (words.length === 0) return true;
    const haystack = normalizeHelpText(`${a.question} ${a.answer} ${CATEGORY_TITLE.get(a.category) ?? ""}`);
    return words.every((w) => haystack.includes(w));
  });
}
