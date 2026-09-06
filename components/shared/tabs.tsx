"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface TabDef {
  id: string;
  label: string;
  content: ReactNode;
}

export function Tabs({ tabs, defaultTab }: { tabs: TabDef[]; defaultTab?: string }) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.id);

  return (
    <div>
      {/* touch-pan-x: tells the browser this row only pans horizontally, so an
          ambiguous tap/drag on a real device resolves to "scroll" or "tap the
          button", never to text selection (was triggering Android's
          selection toolbar — "AI Writing"/"Salin" — instead of switching
          tabs). */}
      <div role="tablist" className="flex touch-pan-x gap-1 overflow-x-auto border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            onClick={() => setActive(tab.id)}
            className={cn(
              // select-none + touch-manipulation: the actual fix for the tap
              // landing as a text selection instead of a click. min-h-11
              // guarantees a real >=44px tap target regardless of label length.
              "-mb-px flex min-h-11 shrink-0 select-none items-center whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium touch-manipulation transition-colors",
              active === tab.id
                ? "border-brand text-brand"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="pt-6">{tabs.find((t) => t.id === active)?.content}</div>
    </div>
  );
}
