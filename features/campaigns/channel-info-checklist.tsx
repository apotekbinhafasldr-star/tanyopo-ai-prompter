import type { CheckStatus, PlatformChecklist } from "@/lib/campaigns/draft-readiness";

const STATUS_TEXT: Record<CheckStatus, string> = {
  PASS: "Terpenuhi",
  FAIL: "Belum",
  UNKNOWN: "Belum dapat dipastikan",
};

/**
 * Read-only information checklist for a channel platform (used for TikTok and X;
 * Meta has its own launch checklist). Shows connection, capability, media and
 * the paid-launch (S1) gate as words. It never offers a launch button and does
 * not touch OAuth or the connector.
 */
export function ChannelInfoChecklist({ platform }: { platform: PlatformChecklist }) {
  return (
    <section
      aria-label={`Checklist ${platform.label}`}
      data-testid={`channel-checklist-${platform.platform.toLowerCase()}`}
      className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-border bg-surface p-4"
    >
      <h3 className="text-sm font-semibold text-foreground">Kesiapan {platform.label}</h3>
      <p className="text-xs text-muted-foreground">Informasi saja. Peluncuran tetap manual dan dijaga server.</p>
      <ul className="flex flex-col divide-y divide-border">
        {platform.checks.map((c) => (
          <li key={c.id} className="flex flex-col gap-0.5 py-2" data-status={c.status}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-foreground">{c.label}</span>
              <span className="text-xs font-medium text-foreground">{STATUS_TEXT[c.status]}</span>
            </div>
            <span className="text-xs text-muted-foreground">{c.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
