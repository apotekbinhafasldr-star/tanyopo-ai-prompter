/**
 * Pure check of TIKTOK_REDIRECT_URI (no server-only, no env access).
 *
 * TikTok rejects a redirect_uri that is not registered EXACTLY in the developer
 * portal (https, absolute, no query, no fragment, < 512 chars; source:
 * developers.tiktok.com/doc/login-kit-web, read 2026-11-15). On top of that
 * LINOE only ever handles the callback at CALLBACK_PATH, so any other path
 * would send the one-time code to a route that cannot finish the flow.
 * Failing here (-> "not configured") is better than a TikTok "illegal redirect"
 * page after the owner already left the app.
 */
export const TIKTOK_CALLBACK_PATH = "/api/connections/tiktok/callback";

export type TikTokRedirectProblem = "invalid_url" | "not_https" | "has_query_or_fragment" | "wrong_path" | "too_long";

export function tiktokRedirectUriProblem(value: string | undefined): TikTokRedirectProblem | null {
  if (!value) return "invalid_url";
  if (value.length >= 512) return "too_long";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "invalid_url";
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return "not_https";
  if (url.search !== "" || url.hash !== "" || value.includes("?") || value.includes("#")) {
    return "has_query_or_fragment";
  }
  if (url.pathname !== TIKTOK_CALLBACK_PATH) return "wrong_path";
  return null;
}
