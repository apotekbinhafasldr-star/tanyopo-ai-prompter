import type { MetadataRoute } from "next";
import { getSiteOrigin } from "@/lib/seo/site-url";

/**
 * robots.txt is a crawl hint, NOT a security control: private areas are protected by authentication
 * (proxy.ts), never by this file.
 *
 * Deliberately blocked: only /api/ (route handlers, including the demo-session starter) and /auth/ (OAuth /
 * email-confirmation route handlers). Login, register, onboarding and /demo are NOT disallowed here on
 * purpose: they carry a `noindex` meta tag, and a crawler can only honour noindex if it is allowed to fetch
 * the page. /_next assets are not blocked, so crawlers can render pages.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = getSiteOrigin();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/auth/"] }],
    sitemap: `${origin}/sitemap.xml`,
  };
}
