"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { decideApprovalAction } from "@/features/approvals/actions";

export function ApprovalDecideButtons({ approvalId }: { approvalId: string }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function decide(decision: "APPROVED" | "REJECTED") {
    setError(null);
    startTransition(async () => {
      try {
        const result = await decideApprovalAction(approvalId, decision, decision === "REJECTED" ? reason || null : null);
        if (result.error) {
          setError(result.error);
        } else {
          setRejecting(false);
          // Called directly (not via <form action>), so revalidatePath()
          // inside the action invalidates the cache but never repaints an
          // already-mounted page on its own — same gotcha already fixed on
          // the campaign submit button (features/campaigns/submit-button.tsx).
          router.refresh();
        }
      } catch {
        setError("Gagal menyimpan keputusan. Silakan coba lagi.");
      }
    });
  }

  if (rejecting) {
    return (
      <div className="flex flex-col gap-2">
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Alasan penolakan (opsional)"
          rows={2}
        />
        <div className="flex gap-2">
          <Button size="sm" variant="destructive" loading={pending} onClick={() => decide("REJECTED")}>
            Konfirmasi Tolak
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
            Batal
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Button size="sm" loading={pending} onClick={() => decide("APPROVED")}>
          <Check />
          Setujui
        </Button>
        <Button size="sm" variant="outline" onClick={() => setRejecting(true)}>
          <X />
          Tolak
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
