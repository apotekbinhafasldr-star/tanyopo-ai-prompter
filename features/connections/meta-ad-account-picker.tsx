"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { listMetaAdAccountsAction, selectMetaAdAccountAction } from "@/features/connections/actions";
import { MetaAdAccountList } from "@/features/connections/meta-ad-account-list";
import type { AdAccountOption } from "@/features/connections/meta-ad-account-selection-core";

/**
 * F-2b — lets the Owner choose which Meta ad account LINOE reads.
 * On-demand (a live read-only call to Meta), never during page render. The
 * server actions re-check everything; this component only presents the list.
 *
 * Never chooses for the Owner: with several accounts nothing is pre-selected
 * unless that account was already confirmed. With exactly one account it is
 * pre-selected (there is nothing ambiguous), but is still saved explicitly.
 */

interface Loaded {
  accounts: AdAccountOption[];
  truncated: boolean;
  selectionConfirmed: boolean;
  currentMissing: boolean;
}

export function MetaAdAccountPicker({
  currentAccountName,
  onSelected,
}: {
  currentAccountName: string | null;
  onSelected: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [chosenId, setChosenId] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [isSaving, startSaving] = useTransition();

  function load() {
    setLoadError(null);
    setSaveError(null);
    setSavedName(null);
    startLoading(async () => {
      try {
        const result = await listMetaAdAccountsAction();
        if (result.error !== null) {
          setLoaded(null);
          setLoadError(result.error);
          return;
        }
        setLoaded({
          accounts: result.accounts,
          truncated: result.truncated,
          selectionConfirmed: result.selectionConfirmed,
          currentMissing: result.currentMissing,
        });
        const only = result.accounts.length === 1 ? result.accounts[0] : null;
        const confirmedCurrent = result.selectionConfirmed ? result.accounts.find((a) => a.isCurrent) : undefined;
        setChosenId(only?.id ?? confirmedCurrent?.id ?? "");
      } catch {
        setLoaded(null);
        setLoadError("Daftar akun iklan gagal dimuat. Coba lagi nanti.");
      }
    });
  }

  function save() {
    if (!chosenId) return;
    setSaveError(null);
    startSaving(async () => {
      try {
        const result = await selectMetaAdAccountAction(chosenId);
        if (result.error !== null) {
          setSaveError(result.error);
          return;
        }
        setSavedName(result.selected.name);
        setLoaded(null);
        setChosenId("");
        onSelected();
      } catch {
        setSaveError("Pilihan akun iklan gagal disimpan. Coba lagi.");
      }
    });
  }

  const current = loaded?.accounts.find((a) => a.isCurrent);
  const canSave = Boolean(loaded) && chosenId !== "" && (!current || chosenId !== current.id || !loaded?.selectionConfirmed);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">Akun iklan</p>

      {!loaded ? (
        <p className="text-xs text-foreground">
          {currentAccountName ? (
            <>
              Akun yang tersimpan: <span className="font-medium">{currentAccountName}</span>
            </>
          ) : (
            "Belum ada akun iklan tersimpan."
          )}
        </p>
      ) : null}

      {savedName ? (
        <p role="status" className="text-xs text-success">
          Akun iklan “{savedName}” dipilih. Jalankan “Periksa Kesiapan” di bawah untuk memeriksanya.
        </p>
      ) : null}

      {!loaded ? (
        <>
          <p className="text-xs text-muted-foreground">
            Jika Anda punya lebih dari satu akun iklan Meta, pilih yang benar. LINOE tidak memilihkannya otomatis. Ini
            hanya menyimpan pilihan; tidak membuat iklan dan tidak mengeluarkan biaya.
          </p>
          <div>
            <Button size="md" variant="secondary" loading={isLoading} onClick={load} className="w-full sm:w-auto">
              {currentAccountName ? "Pilih / Ganti Akun Iklan" : "Pilih Akun Iklan"}
            </Button>
          </div>
        </>
      ) : loaded.accounts.length === 0 ? (
        <>
          <p className="text-xs text-muted-foreground">
            Tidak ada akun iklan pada akun Meta yang terhubung. Buat akun iklan di Meta Ads Manager dan pastikan Anda
            punya peran pada akun itu, lalu muat ulang.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button size="md" variant="secondary" loading={isLoading} onClick={load} className="w-full sm:w-auto">
              Muat Ulang
            </Button>
            <Button size="md" variant="ghost" onClick={() => setLoaded(null)} className="w-full sm:w-auto">
              Tutup
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {loaded.accounts.length === 1
              ? "Hanya ada satu akun iklan pada akun Meta ini."
              : `Ditemukan ${loaded.accounts.length} akun iklan. Pilih salah satu; belum ada yang dipilihkan untuk Anda.`}
          </p>
          {loaded.currentMissing ? (
            <p role="alert" className="text-xs text-danger">
              Akun iklan yang tersimpan di LINOE tidak termasuk akun yang dapat diakses koneksi Meta ini. Pilih akun
              yang benar di bawah.
            </p>
          ) : null}
          {loaded.truncated ? (
            <p className="text-xs text-muted-foreground">
              Hanya 50 akun pertama yang ditampilkan. Jika akun Anda tidak ada, hubungi admin LINOE.
            </p>
          ) : null}

          <MetaAdAccountList
            accounts={loaded.accounts}
            chosenId={chosenId}
            onChoose={setChosenId}
            disabled={isSaving}
            selectionConfirmed={loaded.selectionConfirmed}
          />

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button size="lg" loading={isSaving} disabled={!canSave} onClick={save} className="w-full sm:w-auto">
              Gunakan Akun Ini
            </Button>
            <Button size="lg" variant="ghost" onClick={() => setLoaded(null)} className="w-full sm:w-auto">
              Batal
            </Button>
          </div>
        </>
      )}

      {loadError ? (
        <p role="alert" className="text-xs text-danger">
          {loadError}
        </p>
      ) : null}
      {saveError ? (
        <p role="alert" className="text-xs text-danger">
          {saveError}
        </p>
      ) : null}
    </div>
  );
}
