import Link from "next/link";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { brand } from "@/lib/brand";

const BADGE_SIZE = { sm: "size-7", md: "size-8", lg: "size-10" } as const;
const ICON_SIZE = { sm: "size-3.5", md: "size-4", lg: "size-5" } as const;
const TEXT_SIZE = { sm: "text-sm", md: "text-base", lg: "text-lg" } as const;

export interface LinoeLogoProps {
  size?: keyof typeof BADGE_SIZE;
  showWordmark?: boolean;
  showByline?: boolean;
  /** Pass `null` to render a non-interactive mark (e.g. inside a page that's already a link, or a static footer/auth screen). */
  href?: string | null;
  className?: string;
}

/**
 * LINOE brand mark: a gradient badge (electric blue -> violet, matching the
 * existing --brand/--brand-2 tokens) with an abstract speed/motion glyph
 * (lucide's Zap — reused rather than a hand-rolled SVG path, since it's
 * already a project dependency and reads instantly as "fast/energy") plus
 * an optional wordmark and "by Tanyopo" byline. One component so the mark
 * stays consistent across the marketing header/footer, auth screens, and
 * the authenticated app sidebar.
 */
export function LinoeLogo({
  size = "md",
  showWordmark = true,
  showByline = false,
  href = "/",
  className,
}: LinoeLogoProps) {
  const mark = (
    <span
      className={cn(
        BADGE_SIZE[size],
        "flex shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-gradient-to-br from-brand to-brand-2 text-brand-foreground shadow-[var(--shadow-sm)]",
      )}
    >
      <Zap className={cn(ICON_SIZE[size], "fill-current")} aria-hidden />
    </span>
  );

  const content = (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {mark}
      {showWordmark ? (
        <span className="flex items-baseline gap-1.5">
          <span className={cn(TEXT_SIZE[size], "font-bold tracking-tight text-foreground")}>
            {brand.name}
          </span>
          {showByline ? (
            <span className="text-xs font-medium text-muted-foreground">
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
