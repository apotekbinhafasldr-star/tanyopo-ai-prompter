"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { decideApprovalAction } from "@/features/approvals/actions";

export function ApprovalDecideButtons({ approvalId }: { approvalId: string }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(decision: "APPROVED" | "REJECTED") {
    setError(null);
    startTransition(async () => {
      const result = await decideApprovalAction(approvalId, decision, decision === "REJECTED" ? reason || null : null);
      if (result.error) {
        setError(result.error);
      } else {
        setRejecting(false);
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
