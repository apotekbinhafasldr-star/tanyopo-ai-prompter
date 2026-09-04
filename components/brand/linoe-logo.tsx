import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { brand } from "@/lib/brand";

// Intrinsic dimensions of the founder-approved asset — used to keep Next/Image's
// aspect ratio locked at every render size.
const LOGO_SRC = "/brand/linoe/linoe-logo-vertical.png";
const LOGO_WIDTH = 1024;
const LOGO_HEIGHT = 1536;

const HEIGHT = { sm: 40, md: 48, lg: 72 } as const;

export interface LinoeLogoProps {
  size?: keyof typeof HEIGHT;
  /** Pass `null` to render a non-interactive mark (e.g. inside a page that's already a link, or a static footer/auth screen). */
  href?: string | null;
  className?: string;
}

/**
 * LINOE brand mark — the founder's final, locked asset
 * (public/brand/linoe/linoe-logo-vertical.png): the flowing ribbon L,
 * left-side motion streaks, "LINOE" wordmark, and "by Tanyopo" byline are
 * all baked into one vertical composition on its own dark card. This is
 * the actual supplied PNG, not a redrawn or approximated recreation — it
 * must not be swapped for an SVG interpretation. For compact spots (e.g.
 * the header) it's scaled down by height only, aspect ratio locked, per
 * the founder's explicit instruction to scale the same asset rather than
 * redesign the mark for small spaces. Because the asset is a self-
 * contained dark card, it reads correctly on both light and dark page
 * backgrounds with no separate light/dark variant needed.
 */
export function LinoeLogo({ size = "md", href = "/", className }: LinoeLogoProps) {
  const height = HEIGHT[size];
  const width = Math.round((LOGO_WIDTH / LOGO_HEIGHT) * height);

  const img = (
    <Image
      src={LOGO_SRC}
      alt={`${brand.name} — ${brand.lockup}`}
      width={LOGO_WIDTH}
      height={LOGO_HEIGHT}
      style={{ height, width }}
      className={cn("shrink-0 rounded-[var(--radius-md)]", className)}
      priority
    />
  );

  if (href === null) return img;

  return (
    <Link href={href} aria-label={`${brand.name} — Beranda`} className="inline-flex items-center">
      {img}
    </Link>
  );
}
