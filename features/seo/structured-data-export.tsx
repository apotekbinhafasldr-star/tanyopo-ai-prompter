"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * One copy-ready JSON-LD snippet. Works on a phone: the snippet is shown in a read-only box that can also be
 * selected by hand when the Clipboard API is unavailable (older WebView, insecure context).
 */
export function JsonLdSnippet({ label, snippet }: { label: string; snippet: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="jsonld-snippet">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <Button type="button" size="sm" variant="secondary" onClick={copy}>
          {state === "copied" ? <Check /> : <Copy />}
          {state === "copied" ? "Tersalin" : "Salin"}
        </Button>
      </div>
      <textarea
        readOnly
        aria-label={`${label} (JSON-LD)`}
        value={snippet}
        rows={8}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full rounded-[var(--radius-md)] border border-border bg-surface-muted p-2 font-mono text-xs text-foreground"
      />
      {state === "failed" ? (
        <p role="status" className="text-xs text-warning">
          Salin otomatis tidak tersedia di perangkat ini. Ketuk kotak di atas lalu salin manual.
        </p>
      ) : null}
    </div>
  );
}
