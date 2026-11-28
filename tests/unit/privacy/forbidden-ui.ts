/**
 * Pola teks terlarang pada UI aplikasi untuk Paket 5 (spesifikasi bagian 3, butir 2). Satu larik agar PR berikutnya (5b, 5c) ikut terkunci:
 * cukup menambahkan keadaan yang dirender ke forbidden-ui-text.test.ts. Pola ini TIDAK boleh dilonggarkan.
 */
export const FORBIDDEN_UI: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: "klaim immutable/independen", pattern: /immutable|tidak dapat diubah|independen/i },
  { name: "pejabat/DPO", pattern: /\bDPO\b|Data Protection Officer|Penanggung Jawab|Kami menunjuk|Pejabat Pelindungan Data/i },
  { name: "email kontak karangan", pattern: /(privacy|dpo|pdp)@/i },
  { name: "SLA", pattern: /\bSLA\b|3x24/i },
  { name: "durasi", pattern: /\d+\s*(jam|hari|minggu|bulan|tahun)\b|segera|secepatnya/i },
  { name: "pasal/peraturan", pattern: /Pasal\s*\d+|PP\s*33/i },
  { name: "klaim bukti", pattern: /bukti\s+(persetujuan|penerimaan)/i },
  { name: "klaim pencatatan", pattern: /(mencatat|menyimpan|dicatat|merekam|direkam)\s+(penerimaan|persetujuan)/i },
  { name: "dasar hukum", pattern: /berdasarkan\s+(persetujuan|kontrak)/i },
  { name: "lokasi server", pattern: /lokasi server/i },
  { name: "analitik/pelacak", pattern: /analitik|pelacak/i },
  { name: "klaim keamanan", pattern: /terenkripsi|aman 100/i },
];

export function findForbidden(text: string): string[] {
  return FORBIDDEN_UI.filter((f) => f.pattern.test(text)).map((f) => f.name);
}
