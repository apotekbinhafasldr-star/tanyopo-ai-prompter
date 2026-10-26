import type { MetadataRoute } from "next";
import { LEGAL_LINKS } from "@/features/legal/legal-meta";
import { getSiteOrigin } from "@/lib/seo/site-url";

/**
 * Public, indexable pages only: the landing page and the legal pages. Never the dashboard, API, demo,
 * authentication, onboarding or any tenant page. The legal list comes from LEGAL_LINKS so the sitemap cannot
 * drift from the footer links. No `lastModified` is set: no real per-page modification date is tracked, and
 * none is invented.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = getSiteOrigin();
  const paths = ["/", ...LEGAL_LINKS.map((l) => l.href)];
  return paths.map((path) => ({ url: path === "/" ? origin : `${origin}${path}` }));
}
