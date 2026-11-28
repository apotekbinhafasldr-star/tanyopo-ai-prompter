"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteCampaignAction } from "@/features/campaigns/actions";

/**
 * Owner-only "Hapus Draft". Confirms in the browser, then calls the server action directly and shows its real
 * result: an error is displayed (never a silent redirect), and only a confirmed delete navigates to the list.
 * The server enforces the Owner rule itself; the page also renders this only for the Owner.
 */
export function DeleteCampaignButton({ campaignId, disabled }: { campaignId: string; disabled?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        loading={pending}
        onClick={() => {
          if (!window.confirm("Hapus draft campaign ini? Tindakan ini tidak dapat dibatalkan.")) return;
          setError(null);
          startTransition(async () => {
            try {
              const result = await deleteCampaignAction(campaignId);
              if (result.error) {
                setError(result.error);
              } else {
                router.push("/campaigns");
              }
            } catch {
              setError("Gagal menghapus campaign. Silakan coba lagi.");
            }
          });
        }}
      >
        <Trash2 />
        Hapus Draft
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
