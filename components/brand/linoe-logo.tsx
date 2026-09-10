import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { brand } from "@/lib/brand";

/**
 * Batch B10 — official final logo installation. `official` (the new
 * default) is the founder's final-approved asset
 * (public/brand/linoe/linoe-logo-official.png — a byte-identical copy of
 * the uploaded LINOE_LOGO_FINAL_APPROVED-1.png, not redrawn or
 * reinterpreted). `legacy` is the prior approved asset
 * (public/brand/linoe/linoe-logo-vertical.png), kept only so the frozen
 * Landing page (features/marketing/marketing-header.tsx,
 * app/(marketing)/layout.tsx footer) can keep rendering pixel-identical
 * output — this batch is explicitly scoped to application UI only, not
 * Hero/Landing. Each variant has its own real intrinsic dimensions so
 * Next/Image's aspect ratio is never stretched to fit the other's shape.
 */
const LOGO_ASSETS = {
  official: { src: "/brand/linoe/linoe-logo-official.png", width: 1269, height: 1536 },
  legacy: { src: "/brand/linoe/linoe-logo-vertical.png", width: 1024, height: 1536 },
} as const;

const HEIGHT = { sm: 40, md: 48, lg: 72 } as const;

export interface LinoeLogoProps {
  size?: keyof typeof HEIGHT;
  /** Pass `null` to render a non-interactive mark (e.g. inside a page that's already a link, or a static footer/auth screen). */
  href?: string | null;
  className?: string;
  /** `legacy` keeps the pre-B10 asset — only for the frozen Landing page. */
  variant?: keyof typeof LOGO_ASSETS;
}

export function LinoeLogo({ size = "md", href = "/", className, variant = "official" }: LinoeLogoProps) {
  const asset = LOGO_ASSETS[variant];
  const height = HEIGHT[size];
  const width = Math.round((asset.width / asset.height) * height);

  const img = (
    <Image
      src={asset.src}
      alt={`${brand.name} — ${brand.lockup}`}
      width={asset.width}
      height={asset.height}
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
