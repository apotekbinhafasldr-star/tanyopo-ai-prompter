"use client";

import { useState, useTransition } from "react";
import { Archive, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { archiveProductAction, reactivateProductAction } from "@/features/products/actions";

/**
 * Batch B9 P2-3 — the one UI entry point for the product archive/reactivate
 * lifecycle, so the maxActiveProducts cap (enforced server-side in
 * fn_activate_product/fn_archive_product) has somewhere for a tenant to
 * actually free or re-claim a slot, not just an unused server action.
 */
export function ProductLifecycleButton({ productId, status }: { productId: string; status: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isActive = status === "ACTIVE";

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        variant="ghost"
        size="sm"
        loading={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = isActive ? await archiveProductAction(productId) : await reactivateProductAction(productId);
            if (result.error) {
              setError(result.error);
            }
          });
        }}
      >
        {isActive ? (
          <>
            <Archive />
            Arsipkan
          </>
        ) : (
          <>
            <RotateCcw />
            Aktifkan Kembali
          </>
        )}
      </Button>
      {error ? (
        <p role="alert" className="max-w-xs text-right text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
