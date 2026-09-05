import { Bell, TrendingUp, UserPlus, Target, Users2, Music2, Camera, MessagesSquare, Search, MessageCircle } from "lucide-react";

const STATS = [
  { icon: TrendingUp, label: "Penjualan", color: "text-success" },
  { icon: UserPlus, label: "Leads", color: "text-brand-2" },
  { icon: Target, label: "ROAS", color: "text-[#3b82f6]" },
  { icon: Users2, label: "Audiens", color: "text-warning" },
];

const CHANNELS = [
  { icon: Music2, label: "TikTok" },
  { icon: Camera, label: "Instagram" },
  { icon: MessagesSquare, label: "Facebook" },
  { icon: Search, label: "Google Ads" },
  { icon: MessageCircle, label: "WhatsApp" },
];

/**
 * Desktop-only third hero column: a real (not screenshotted) preview of the
 * LINOE dashboard, reconstructed from the founder's approved desktop
 * reference. Two deliberate departures from that reference, both for
 * truthfulness reasons already established elsewhere on this site:
 * - Stat tiles show a blurred placeholder bar instead of a number — the
 *   reference itself already renders these as blurred/redacted, so this
 *   matches it exactly rather than inventing a figure.
 * - The channel list is presented as capabilities ("Channel yang
 *   Didukung"), not live "Terhubung" (Connected) status — this app has no
 *   real connections to claim from a marketing page, matching the
 *   Omnichannel section's own rule elsewhere on this site.
 */
export function HeroDashboardPanel() {
  return (
    <div className="overflow-hidden rounded-[var(--radius-xl)] border border-border bg-surface shadow-[0_32px_64px_-16px_rgba(0,0,0,0.35)]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-xs font-semibold text-muted-foreground">Dashboard</span>
        <div className="flex items-center gap-2.5">
          <Bell className="size-4 text-muted-foreground" aria-hidden />
          <span className="flex size-7 items-center justify-center rounded-full bg-brand-muted text-xs font-semibold text-brand">
            O
          </span>
        </div>
      </div>

      <div className="p-4">
        <h3 className="text-sm font-semibold leading-snug text-foreground">
          Pertumbuhan Bisnis Anda Dimulai di Sini.
        </h3>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {STATS.map((stat) => (
            <div key={stat.label} className="rounded-[var(--radius-md)] border border-border bg-surface-muted/60 p-2.5">
              <stat.icon className={`size-4 ${stat.color}`} aria-hidden />
              <p className="mt-1.5 text-[11px] font-medium text-foreground">{stat.label}</p>
              <div aria-hidden className="mt-1.5 h-2.5 w-12 rounded-full bg-surface-muted" />
            </div>
          ))}
        </div>

        <div className="mt-3 rounded-[var(--radius-md)] border border-border p-2.5">
          <p className="text-[11px] font-medium text-muted-foreground">Performa Campaign</p>
          <svg viewBox="0 0 220 56" className="mt-1.5 w-full" aria-hidden>
            <path
              d="M0 40 Q 20 20, 40 30 T 80 24 T 120 34 T 160 16 T 220 22"
              fill="none"
              stroke="var(--brand-2)"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="M0 46 Q 25 38, 50 42 T 100 30 T 150 38 T 220 28"
              fill="none"
              stroke="var(--brand)"
              strokeWidth="2"
              strokeLinecap="round"
              opacity="0.6"
            />
          </svg>
        </div>

        <div className="mt-3 rounded-[var(--radius-md)] border border-border p-2.5">
          <p className="text-[11px] font-medium text-muted-foreground">Channel yang Didukung</p>
          <div className="mt-2 flex flex-col gap-1.5">
            {CHANNELS.map((channel) => (
              <div key={channel.label} className="flex items-center gap-2">
                <channel.icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="text-[11px] font-medium text-foreground">{channel.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
