"use client";

import { useCallback, useEffect, useRef } from "react";

const KEY = "__backLayer";

type LayerState = Record<string, unknown>;
const currentState = (): LayerState => {
  const s = window.history.state;
  return s && typeof s === "object" ? { ...(s as LayerState) } : {};
};

/**
 * Tombol Back Android untuk lapisan sementara (drawer, konfirmasi) yang bukan halaman.
 *
 * Saat `open` menjadi true, satu entri riwayat didorong (`pushState`, URL sama, state Next.js dipertahankan).
 * Back fisik lalu hanya menutup lapisan (`onClose`) dan tidak meninggalkan halaman. Bila lapisan ditutup dengan
 * cara lain (tombol X, Escape, overlay), entri itu dibuang dengan `history.back()` agar tidak ada langkah Back kosong.
 *
 * `release()` dipakai sebelum navigasi (mis. ketuk tautan di drawer): entri tidak dibuang dengan back() (balapan
 * dengan router.push), hanya ditandai bukan-lapisan lagi.
 */
export function useBackToClose(open: boolean, onClose: () => void): { release: () => void } {
  const onCloseRef = useRef(onClose);
  const pushed = useRef(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    window.history.pushState({ ...currentState(), [KEY]: true }, "");
    pushed.current = true;

    const onPop = (event: PopStateEvent) => {
      // Mendarat di entri lapisan lain (back() buatan kita sendiri) bukan permintaan pengguna.
      if (!pushed.current || (event.state && (event.state as LayerState)[KEY])) return;
      pushed.current = false;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (pushed.current) {
        pushed.current = false;
        const s = window.history.state as LayerState | null;
        if (s && s[KEY]) window.history.back();
      }
    };
  }, [open]);

  const release = useCallback(() => {
    if (!pushed.current) return;
    pushed.current = false;
    const s = currentState();
    delete s[KEY];
    window.history.replaceState(s, "");
  }, []);

  return { release };
}
