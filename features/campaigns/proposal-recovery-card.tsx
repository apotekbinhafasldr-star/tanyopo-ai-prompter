import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RegenerateProposalButton } from "@/features/campaigns/regenerate-button";
import { proposalRecoveryAccess, type StoredProposalShape } from "@/lib/campaigns/proposal-recovery";

const COPY: Record<Exclude<StoredProposalShape, "OK">, { title: string; body: string }> = {
  MISSING: {
    title: "Strategi iklan belum ada",
    body: "Campaign ini belum punya strategi dan teks iklan dari AI, jadi belum bisa diajukan untuk persetujuan.",
  },
  MALFORMED: {
    title: "Strategi iklan tidak bisa dibaca",
    body: "Data strategi campaign ini rusak atau berformat lama, jadi teks iklannya tidak bisa ditampilkan. Buat ulang strategi agar campaign bisa dilanjutkan.",
  },
  INCOMPLETE: {
    title: "Teks iklan belum lengkap",
    body: "Judul, teks utama, atau ajakan (CTA) belum terisi, jadi campaign belum bisa diajukan. Lengkapi lewat editor di bagian Konten Iklan, atau buat ulang seluruh strategi dengan AI.",
  },
};

/**
 * Explains an unusable stored proposal in plain Indonesian and offers the repair only when the role and the
 * campaign status allow it (see lib/campaigns/proposal-recovery.ts). Rendering never calls the AI: the button
 * runs the action only after the user presses it. INCOMPLETE has no button here: the page already offers the copy
 * editor and the regenerate button in the strategy card.
 */
export function ProposalRecoveryCard({
  campaignId,
  shape,
  role,
  status,
}: {
  campaignId: string;
  shape: Exclude<StoredProposalShape, "OK">;
  role: string | null | undefined;
  status: string;
}) {
  const access = proposalRecoveryAccess(role, status);
  const copy = COPY[shape];
  return (
    <Card data-testid="proposal-recovery" role="region" aria-labelledby="proposal-recovery-title">
      <CardHeader>
        <CardTitle id="proposal-recovery-title">{copy.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
        <p>{copy.body}</p>
        {access.allowed ? (
          shape === "INCOMPLETE" ? null : (
            <div className="flex flex-col gap-2" data-testid="proposal-recovery-action">
              {/* Button size "sm" is 44px tall below the sm breakpoint (phones), see components/ui/button.tsx. */}
              <RegenerateProposalButton campaignId={campaignId} />
              <p className="text-xs">
                AI hanya berjalan setelah Anda menekan tombol. Membuat ulang memakai kuota AI paket Anda dan menggantikan strategi yang ada.
              </p>
            </div>
          )
        ) : (
          <p data-testid="proposal-recovery-reason" className="text-foreground">
            {access.reason}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
