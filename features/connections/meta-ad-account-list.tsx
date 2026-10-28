import { Badge } from "@/components/ui/badge";
import type { AdAccountOption } from "@/features/connections/meta-ad-account-selection-core";
import type { ReadinessState } from "@/lib/connectors/meta-readiness";

/**
 * F-2b — the ad-account choices as a radio list. Pure rendering (no fetching,
 * no state of its own) so it can be unit-tested with `renderToStaticMarkup`.
 *
 * Mobile-first: one full-width card per account, a >=48px tap target (the whole
 * card is the label), long names wrap instead of overflowing, no horizontal
 * scroll. Nothing is pre-selected by this component: the caller decides, and
 * with several accounts it must not pick one for the Owner.
 */

const READINESS_LABEL: Record<ReadinessState, string> = {
  READY: "Siap",
  NOT_READY: "Belum siap",
  UNKNOWN: "Belum bisa dipastikan",
};
const READINESS_VARIANT: Record<ReadinessState, "success" | "danger" | "warning"> = {
  READY: "success",
  NOT_READY: "danger",
  UNKNOWN: "warning",
};

export interface MetaAdAccountListProps {
  accounts: readonly AdAccountOption[];
  chosenId: string;
  onChoose?: (id: string) => void;
  disabled?: boolean;
  /** The Owner confirmed the stored account since the latest (re)connect. */
  selectionConfirmed: boolean;
}

export function MetaAdAccountList({ accounts, chosenId, onChoose, disabled, selectionConfirmed }: MetaAdAccountListProps) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" disabled={disabled} data-testid="meta-ad-account-list">
      <legend className="sr-only">Pilih akun iklan Meta</legend>
      {accounts.map((account) => (
        <label
          key={account.id}
          className="flex min-h-12 cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-3 has-[:checked]:border-brand has-[:checked]:ring-1 has-[:checked]:ring-brand"
          data-testid="meta-ad-account-option"
          data-account-id={account.id}
        >
          <input
            type="radio"
            name="meta-ad-account"
            value={account.id}
            checked={chosenId === account.id}
            onChange={() => onChoose?.(account.id)}
            className="mt-0.5 size-5 shrink-0 accent-brand"
          />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 break-words text-sm font-medium text-foreground">{account.name}</span>
              {account.isCurrent ? (
                <Badge variant={selectionConfirmed ? "brand" : "warning"}>
                  {selectionConfirmed ? "Sedang dipakai" : "Tersimpan, belum Anda konfirmasi"}
                </Badge>
              ) : null}
            </span>
            <span className="break-all text-xs text-muted-foreground">
              {account.id} · {account.currency ?? "Mata uang belum diketahui"} · {account.statusLabel}
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <Badge variant={READINESS_VARIANT[account.readiness]}>{READINESS_LABEL[account.readiness]}</Badge>
            </span>
            {account.notes.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {account.notes.map((note, i) => (
                  <li key={i} className="text-xs text-muted-foreground">
                    {note}
                  </li>
                ))}
              </ul>
            ) : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
