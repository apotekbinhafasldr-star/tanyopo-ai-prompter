import { ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ConsentSection } from "@/features/consent/consent-section";
import { LegalDocsCard } from "@/features/privacy/legal-docs-card";
import { RightsSection } from "@/features/privacy/rights-section";
import type { LegalDocRow } from "@/features/privacy/legal-docs";

export const PAGE_INTRO =
  "Atur persetujuan opsional, lihat dokumen hukum yang berlaku, dan ajukan permintaan terkait data Anda. Menyetujui Syarat & Ketentuan atau membaca Kebijakan Privasi tidak sama dengan memberi persetujuan di halaman ini. Anda bebas menolak; fitur lain tetap berjalan.";
export const SCOPE_NOTE = "Persetujuan di halaman ini hanya berlaku untuk tujuan yang tertulis pada kartunya. Pemrosesan lain dijelaskan di Kebijakan Privasi.";
export const MARKETING_NOTE_TITLE = "Persetujuan koneksi platform";
export const MARKETING_NOTE_BODY = "Persetujuan koneksi platform diberikan oleh Owner. Anda tidak perlu mengisi apa pun di sini. Persetujuan Owner tidak otomatis mewakili Anda.";

const NAV_LINK = "inline-flex min-h-11 items-center rounded-[var(--radius-md)] border border-border px-3 text-sm font-medium text-foreground hover:bg-surface-muted";

/**
 * Komposisi halaman Privasi & Data Saya. Tiga bagian dimuat terpisah (galat satu bagian tidak menjatuhkan lainnya):
 * persetujuan (ConsentSection, memuat sendiri), dokumen hukum (baris dari pemanggil), permintaan (statis).
 * Owner: kartu persetujuan koneksi. marketing: kartu catatan tanpa lencana. Peran lain: tanpa kartu koneksi (keadaan kosong dari panel).
 */
export function PrivacyPage({
  role,
  timeZone,
  legalRows,
  legalLoadError,
  contactEmail,
}: {
  role: string;
  timeZone: string;
  legalRows: LegalDocRow[];
  legalLoadError: boolean;
  contactEmail: string;
}) {
  const isOwner = role === "owner";
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 sm:p-8">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-foreground" aria-hidden />
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Privasi &amp; Data Saya</h1>
        </div>
        <p className="text-sm text-foreground">{PAGE_INTRO}</p>
        <nav aria-label="Bagian halaman" className="flex flex-wrap gap-2">
          <a href="#persetujuan" className={NAV_LINK}>
            Persetujuan
          </a>
          <a href="#dokumen" className={NAV_LINK}>
            Dokumen
          </a>
          <a href="#permintaan" className={NAV_LINK}>
            Permintaan
          </a>
        </nav>
      </div>

      <div id="persetujuan" className="flex scroll-mt-20 flex-col gap-3">
        {role === "marketing" ? (
          <Card>
            <CardContent className="flex flex-col gap-2 p-4">
              <h2 className="text-base font-semibold tracking-tight text-foreground">{MARKETING_NOTE_TITLE}</h2>
              <p className="text-sm text-foreground">{MARKETING_NOTE_BODY}</p>
            </CardContent>
          </Card>
        ) : null}
        <ConsentSection timeZone={timeZone} includeConnections={isOwner} title="Persetujuan opsional" intro={SCOPE_NOTE} />
      </div>

      <section id="dokumen" aria-labelledby="dokumen-title" className="flex scroll-mt-20 flex-col gap-3">
        <h2 id="dokumen-title" className="text-base font-semibold tracking-tight text-foreground">
          Dokumen hukum
        </h2>
        <LegalDocsCard rows={legalRows} loadError={legalLoadError} />
      </section>

      <section id="permintaan" aria-labelledby="permintaan-title" className="flex scroll-mt-20 flex-col gap-3">
        <h2 id="permintaan-title" className="text-base font-semibold tracking-tight text-foreground">
          Permintaan terkait data Anda
        </h2>
        <RightsSection email={contactEmail} />
      </section>
    </div>
  );
}
