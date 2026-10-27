"use client";

import { useState } from "react";
import { MetaAdAccountPicker } from "@/features/connections/meta-ad-account-picker";
import { MetaReadinessPanel } from "@/features/connections/meta-readiness-panel";

/**
 * F-2b — the Owner's "Akun iklan" block on the Meta card: choose the ad
 * account, then check its readiness. After a new choice the readiness panel is
 * remounted so a result computed for the previous account can never stay on
 * screen next to the new one.
 */
export function MetaAdAccountSection({ currentAccountName }: { currentAccountName: string | null }) {
  const [selectionVersion, setSelectionVersion] = useState(0);

  return (
    <div className="flex min-w-0 flex-col gap-3 border-t border-border pt-3" data-testid="meta-ad-account-section">
      <MetaAdAccountPicker
        currentAccountName={currentAccountName}
        onSelected={() => setSelectionVersion((v) => v + 1)}
      />
      <MetaReadinessPanel key={selectionVersion} />
    </div>
  );
}
