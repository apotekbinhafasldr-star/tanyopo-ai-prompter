"use client";

import { useEffect, useRef } from "react";

/**
 * Hidden form field carrying the minimal, coarse browser signals used by trial anti-abuse
 * (see lib/trial-abuse/signals.ts for exactly what is, and deliberately is not, collected).
 * Rendered only when the server says collection is enabled; otherwise nothing is read from the browser.
 * Values are computed once on mount; there is no canvas/WebGL/audio probing and no third-party call.
 */
export function DeviceSignalsField() {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const payload = {
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        lang: (navigator.language || "").split(",")[0],
        sw: window.screen.width,
        sh: window.screen.height,
        dpr: window.devicePixelRatio,
        hc: navigator.hardwareConcurrency,
      };
      if (ref.current) ref.current.value = JSON.stringify(payload);
    } catch {
      // Signals are optional: a failure just means no device signal for this attempt.
    }
  }, []);

  return <input ref={ref} type="hidden" name="deviceSignals" defaultValue="" />;
}
