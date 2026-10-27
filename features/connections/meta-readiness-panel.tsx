"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { checkMetaAdAccountReadinessAction } from "@/features/connections/actions";
import { MetaReadinessView } from "@/features/connections/meta-readiness-view";
import type { MetaReadinessResult } from "@/lib/connectors/meta-readiness";

/**
 * F-2a — "Periksa kesiapan akun iklan" for the connected Meta account.
 * On-demand only (like the Page picker): the check makes live Graph calls, so
 * it is never run while the Connections page renders. The server action is
 * read-only; this component only shows what it returns, and the result is kept
 * in component state — nothing is stored and nothing is cached.
 */
export function MetaReadinessPanel() {
  const [result, setResult] = useState<MetaReadinessResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isChecking, startChecking] = useTransition();

  function runCheck() {
    setError(null);
    startChecking(async () => {
      try {
        const response = await checkMetaAdAccountReadinessAction();
        if (response.error !== null) {
          setResult(null);
          setError(response.error);
          return;
        }
        setResult(response.result);
      } catch {
        // Never READY on a failed round trip.
        setResult(null);
        setError("Pemeriksaan gagal dijalankan. Coba lagi nanti.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <p className="text-xs font-medium text-muted-foreground">Kesiapan akun iklan</p>

      {result ? <MetaReadinessView result={result} /> : null}

      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}

      {!result && !error ? (
        <p className="text-xs text-muted-foreground">
          Periksa apakah akun iklan Meta Anda aktif, bermata uang IDR, dan memiliki metode pembayaran. Hanya membaca
          data, tidak membuat iklan.
        </p>
      ) : null}

      <div>
        <Button size="sm" variant="secondary" loading={isChecking} onClick={runCheck}>
          {result || error ? "Periksa Ulang" : "Periksa Kesiapan"}
        </Button>
      </div>
    </div>
  );
}
