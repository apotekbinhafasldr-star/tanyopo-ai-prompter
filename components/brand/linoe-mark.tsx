/**
 * The LINOE mark: an abstract "L" ribbon — a single smooth-curved flowing
 * stroke (not a sharp right angle), with a light inner highlight offset on
 * top to read as a dimensional ribbon rather than a flat line, plus three
 * horizontal motion streaks trailing from its left side. L (the initial) +
 * forward motion/speed + growth. Deliberately NOT a lightning bolt: no
 * jagged zig-zag, only one continuous curve. cyan -> electric blue ->
 * violet gradient, distinct from the site-wide --brand/--brand-2 tokens
 * (which stay indigo/violet everywhere else) — scoped to this one mark.
 */
export function LinoeMark({ className }: { className?: string }) {
  const gradientId = "linoe-mark-gradient";
  const strokePath = "M9.5 4 V13.25 Q9.5 18 14.25 18 H21";

  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="1" y1="4" x2="21" y2="18" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="50%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>

      {/* Motion streaks, trailing left of the L, growing bolder toward the middle. */}
      <path d="M1 7 H5" stroke={`url(#${gradientId})`} strokeWidth="1.6" strokeLinecap="round" opacity="0.45" />
      <path d="M-0.5 10.5 H6" stroke={`url(#${gradientId})`} strokeWidth="1.6" strokeLinecap="round" opacity="0.8" />
      <path d="M0.5 14 H5" stroke={`url(#${gradientId})`} strokeWidth="1.6" strokeLinecap="round" opacity="0.5" />

      {/* The ribbon L itself: one continuous curved stroke. */}
      <path d={strokePath} stroke={`url(#${gradientId})`} strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
      {/* Thin light highlight, offset toward the upper-left edge, to give the ribbon a dimensional/flowing feel. */}
      <path
        d={strokePath}
        stroke="white"
        strokeWidth="0.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.35"
        transform="translate(-0.55,-0.55)"
      />
    </svg>
  );
}
