/**
 * The LINOE mark: an abstract "L" ribbon (a single smooth-curved stroke,
 * not a sharp right angle) with three horizontal motion streaks trailing
 * from its left side — L (the initial) + forward motion/speed + growth.
 * Deliberately NOT a lightning bolt. cyan -> electric blue -> violet
 * gradient, distinct from the site-wide --brand/--brand-2 tokens (which
 * stay indigo/violet everywhere else) — scoped to this one mark only.
 */
export function LinoeMark({ className }: { className?: string }) {
  const gradientId = "linoe-mark-gradient";
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="2" y1="4" x2="20" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="50%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      {/* Motion streaks, trailing left of the L, fading as they near the top. */}
      <path d="M1 15.5 H5.5" stroke={`url(#${gradientId})`} strokeWidth="1.75" strokeLinecap="round" opacity="0.55" />
      <path d="M0 12 H6.5" stroke={`url(#${gradientId})`} strokeWidth="1.75" strokeLinecap="round" opacity="0.8" />
      <path d="M1.5 8.5 H5.5" stroke={`url(#${gradientId})`} strokeWidth="1.75" strokeLinecap="round" opacity="0.5" />
      {/* The L itself: vertical stroke curving smoothly into the horizontal foot. */}
      <path
        d="M9.5 4.5 V14.5 Q9.5 18 13 18 H20"
        stroke={`url(#${gradientId})`}
        strokeWidth="3.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
