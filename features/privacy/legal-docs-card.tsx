import { Card, CardContent } from "@/components/ui/card";
import { ReloadButton } from "@/features/privacy/reload-button";
import type { LegalDocRow } from "@/features/privacy/legal-docs";

export const LEGAL_DOCS_LOAD_ERROR = "Riwayat dokumen belum dapat dimuat.";

/** Bagian Dokumen hukum (baca-saja). Tanpa tombol terima: aksi penerimaan ada di paket lain. */
export function LegalDocsCard({ rows, loadError }: { rows: LegalDocRow[]; loadError?: boolean }) {
  if (loadError) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <p role="alert" className="text-sm text-danger">
            {LEGAL_DOCS_LOAD_ERROR}
          </p>
          <div>
            <ReloadButton />
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-0">
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.key} className="flex flex-col gap-2 p-4">
              <p className="text-sm font-semibold text-foreground">{row.name}</p>
              <p className="break-words text-sm text-foreground">{row.status}</p>
              {row.hasNewer ? <p className="text-sm text-foreground">{`Ada versi terbaru (${row.currentVersion}). Baca sekarang.`}</p> : null}
              <a
                href={row.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center self-start text-sm font-medium text-brand underline underline-offset-2"
              >
                {row.readLabel}
                <span className="sr-only"> (dibuka di tab baru)</span>
              </a>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
