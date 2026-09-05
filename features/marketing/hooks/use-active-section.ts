"use client";

import { useEffect, useState } from "react";

/**
 * Tracks which of the given `#id` anchors is currently most in view, for a
 * scroll-spy nav underline/active-state. Shared by both marketing navbars
 * (the hero's integrated nav and the real header shown after scrolling) so
 * they behave identically rather than only one of them supporting an active
 * indicator.
 */
export function useActiveSection(hrefs: readonly string[], defaultHref: string): string {
  const [activeHref, setActiveHref] = useState<string>(defaultHref);

  useEffect(() => {
    const ids = hrefs.map((href) => href.slice(1));
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActiveHref(`#${visible.target.id}`);
      },
      { rootMargin: "-40% 0px -50% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hrefs is a stable module-level constant at every call site
  }, []);

  return activeHref;
}
