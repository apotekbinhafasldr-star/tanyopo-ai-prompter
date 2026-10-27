"use client";

/** Never shows the error message: it could contain internal details. */
export default function FinanceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" style={{ padding: 16, borderRadius: 14, background: "#fdeaea", color: "#b42323", display: "grid", gap: 10 }}>
      <strong>Data keuangan belum bisa ditampilkan</strong>
      <span style={{ fontSize: 14 }}>Terjadi kendala saat memuat halaman ini. Tidak ada data yang berubah. Coba lagi sebentar lagi.</span>
      <button type="button" onClick={reset} style={{ minHeight: 44, borderRadius: 10, border: 0, background: "#0b1f3a", color: "#fff", fontWeight: 700 }}>
        Coba lagi
      </button>
    </div>
  );
}
