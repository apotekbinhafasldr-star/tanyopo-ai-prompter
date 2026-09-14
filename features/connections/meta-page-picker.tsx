"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { listMetaPagesAction, selectMetaPageAction, type MetaPage } from "@/features/connections/actions";

/**
 * Track B — lets the Owner pick which Facebook Page ad creatives run as.
 * Deliberately load-on-demand rather than fetched during the Connections
 * page's own server render: the list comes from a live Graph API call
 * (`/me/accounts`), and doing that on every page view would slow down a
 * page that's otherwise pure DB reads, and fail the whole page if Meta's
 * API is briefly slow. `selectMetaPageAction` re-verifies the chosen id
 * against Meta again server-side — this component never has to be
 * trusted, it's just a picker.
 */
export function MetaPagePicker({ selectedPageName }: { selectedPageName: string | null }) {
  const [pages, setPages] = useState<MetaPage[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isLoading, startLoading] = useTransition();
  const [isSaving, startSaving] = useTransition();

  function loadPages() {
    setLoadError(null);
    setSaved(false);
    startLoading(async () => {
      const result = await listMetaPagesAction();
      if (result.error !== null) {
        setLoadError(result.error);
        setPages(null);
        return;
      }
      setPages(result.pages);
      setSelectedId(result.pages[0]?.id ?? "");
    });
  }

  function savePage() {
    if (!selectedId) return;
    setSaveError(null);
    startSaving(async () => {
      const result = await selectMetaPageAction(selectedId);
      if (result.error) {
        setSaveError(result.error);
        return;
      }
      setSaved(true);
      setPages(null);
    });
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <p className="text-xs font-medium text-muted-foreground">Facebook Page untuk iklan</p>
      {selectedPageName && !pages ? (
        <p className="text-xs text-foreground">
          Terpilih: <span className="font-medium">{selectedPageName}</span>
        </p>
      ) : !pages ? (
        <p className="text-xs text-danger">
          Belum ada Page dipilih — pembuatan iklan Meta akan gagal sampai Page dipilih.
        </p>
      ) : null}

      {saved ? <p className="text-xs text-success">Page berhasil disimpan.</p> : null}

      {!pages ? (
        <Button size="sm" variant="secondary" loading={isLoading} onClick={loadPages}>
          {selectedPageName ? "Ganti Page" : "Pilih Page"}
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {pages.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Tidak ada Facebook Page yang dapat diakses oleh akun Meta yang terhubung.
            </p>
          ) : (
            <>
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className="h-9 rounded-[var(--radius-md)] border border-border-strong bg-surface px-2 text-sm text-foreground"
              >
                {pages.map((page) => (
                  <option key={page.id} value={page.id}>
                    {page.name}
                  </option>
                ))}
              </select>
              <Button size="sm" loading={isSaving} onClick={savePage}>
                Simpan
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => setPages(null)}>
            Batal
          </Button>
        </div>
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
