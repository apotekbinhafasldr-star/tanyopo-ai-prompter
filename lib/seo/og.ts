/**
 * Shared Open Graph / Twitter metadata pieces.
 *
 * The image is a STATIC PNG under public/ (not a dynamic opengraph-image
 * route): proxy.ts gates extension-less paths behind login, so a dynamic
 * route would redirect social crawlers, while static .png assets stay public.
 * The URL is relative and resolved against `metadataBase` (getSiteOrigin()).
 */
export const SITE_TITLE = "LINOE — AI Marketing & Growth Platform by Tanyopo";

export const SITE_DESCRIPTION =
  "LINOE membantu menganalisis produk, menyusun strategi, membuat konten, dan menyiapkan campaign marketing dengan AI dalam satu platform. Coba gratis 14 hari.";

export const OG_IMAGE = {
  url: "/brand/linoe/og-linoe-1200x630.png",
  width: 1200,
  height: 630,
  alt: "LINOE by Tanyopo — AI Marketing & Growth Platform",
} as const;
