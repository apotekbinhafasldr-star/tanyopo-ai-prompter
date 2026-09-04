import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { brand } from "@/lib/brand";
import { LinoeMark } from "@/components/brand/linoe-mark";

const BADGE_SIZE = { sm: "size-8", md: "size-9", lg: "size-12" } as const;
const ICON_SIZE = { sm: "size-4", md: "size-4.5", lg: "size-6" } as const;
const TEXT_SIZE = { sm: "text-base", md: "text-lg", lg: "text-2xl" } as const;

export interface LinoeLogoProps {
  size?: keyof typeof BADGE_SIZE;
  showWordmark?: boolean;
  showByline?: boolean;
  /** Pass `null` to render a non-interactive mark (e.g. inside a page that's already a link, or a static footer/auth screen). */
  href?: string | null;
  className?: string;
  /** "onDark" swaps the badge chip and wordmark for light-on-dark treatment — for use over a dark hero backdrop (e.g. the transparent header before scroll). */
  tone?: "default" | "onDark";
}

/**
 * LINOE brand mark: a dark (near-black) badge holding the LinoeMark — an
 * abstract "L" ribbon with left-side motion streaks, in its own cyan ->
 * electric blue -> violet gradient (components/brand/linoe-mark.tsx). A
 * dark chip rather than a brand-gradient one so the mark's own gradient
 * reads clearly instead of competing with a second gradient behind it —
 * and so the whole page isn't gradient-on-gradient everywhere. Plus an
 * optional wordmark and "by Tanyopo" byline. One component so the mark
 * stays consistent across the marketing header/footer, auth screens, and
 * the authenticated app sidebar.
 *
 * NOTE — brand asset status: this is a frontend-safe programmatic
 * direction, not a final trademark asset. No vector/binary master logo
 * exists in this repository; a designer-produced SVG (and a real favicon/
 * app-icon export from it) is still pending and should replace this glyph
 * in place, without any other component needing to change.
 */
export function LinoeLogo({
  size = "md",
  showWordmark = true,
  showByline = false,
  href = "/",
  className,
  tone = "default",
}: LinoeLogoProps) {
  const onDark = tone === "onDark";

  const mark = (
    <span
      className={cn(
        BADGE_SIZE[size],
        "flex shrink-0 items-center justify-center rounded-[var(--radius-lg)]",
        onDark
          ? "border border-white/15 bg-white/10 backdrop-blur"
          : "bg-ink shadow-[var(--shadow-glow)]",
      )}
    >
      <LinoeMark className={ICON_SIZE[size]} />
    </span>
  );

  const content = (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {mark}
      {showWordmark ? (
        <span className="flex items-baseline gap-1.5">
          <span
            className={cn(
              TEXT_SIZE[size],
              "font-bold tracking-tight",
              onDark ? "text-white" : "text-foreground",
            )}
          >
            {brand.name}
          </span>
          {showByline ? (
            <span className={cn("text-xs font-medium", onDark ? "text-white/70" : "text-muted-foreground")}>
              by {brand.parentCompany}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );

  if (href === null) return content;

  return (
    <Link href={href} aria-label={`${brand.name} — Beranda`} className="inline-flex items-center">
      {content}
    </Link>
  );
}
