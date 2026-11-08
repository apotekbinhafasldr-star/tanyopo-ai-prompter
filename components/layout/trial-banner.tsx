import Link from "next/link";

interface TrialBannerProps {
  /** Whole days left in the trial (rounded up), as derived by getTrialState(). */
  daysRemaining: number | null;
  expired: boolean;
}

/**
 * Trial status strip for the app shell. Pure display: it renders what
 * getTrialState() (services/billing.ts) already decided and never claims a
 * paid plan or an active payment. Wording for the expired case follows the
 * Billing page: online payment is not available yet, so AI features are paused.
 */
export function TrialBanner({ daysRemaining, expired }: TrialBannerProps) {
  if (expired) {
    return (
      <div
        role="status"
        className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger sm:px-8"
      >
        <p>Trial berakhir, fitur AI dijeda. Pembayaran online belum tersedia.</p>
        <Link href="/billing" className="font-medium underline-offset-4 hover:underline">
          Lihat paket
        </Link>
      </div>
    );
  }

  if (daysRemaining === null) return null;

  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-brand/30 bg-brand/5 px-4 py-2 text-sm text-foreground sm:px-8"
    >
      <p>Trial LINOE: sisa {daysRemaining} hari</p>
      <Link href="/billing" className="font-medium text-brand underline-offset-4 hover:underline">
        Lihat paket
      </Link>
    </div>
  );
}
