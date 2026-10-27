# Optimasi Pajak Legal (Phase E)

Route: `/admin/finance/tax/optimization` (di belakang `ADMIN_CENTER_ENABLED`; izin server `tax.optimization.view`, 404 jika tidak berizin).
Query: `skenario=contoh` (satu-satunya nilai diterima; selain itu diabaikan).
Menu pajak (chip, bukan navigasi bawah): Rekap pajak | Panduan lapor | Optimasi Pajak Legal (chip ketiga hanya untuk yang berizin).

## Prinsip
- Bukan aplikasi, database, buku besar, atau dasbor baru. Memakai mesin keuangan (#61), Admin Center (#62), rekonsiliasi fiskal + paket Coretax (#63), wizard (#64).
- **Mesin tidak pernah memilih skema.** `recommended` selalu `null`. Pilihan dan persetujuan akhir ada pada Founder (`tax.optimization.approve`, Founder-only, tidak dapat diberikan ke staf, tidak ada di allow-list migrasi).
- Empat status angka. Satu angka hanya sekuat bahan terlemahnya:
  | Status | Arti | Angka |
  |---|---|---|
  | TERVERIFIKASI | ketentuan DAN data diverifikasi orang bernama | ya |
  | SIMULASI | hitungan ada, tetapi ketentuan atau data belum terverifikasi | ya, berlabel |
  | PERLU VERIFIKASI AKUNTAN/KONSULTAN PAJAK | ketidakpastian hukum | tidak dihitung |
  | BELUM DAPAT DIHITUNG | data kurang | tidak ada angka |
- Pembukuan asli tidak diubah. Koreksi fiskal dari biaya nondeductible dibuat sebagai `FiscalAdjustment` terpisah (`opt|expense|<id>`), terverifikasi, dengan bukti.
- Tidak ada pengiriman SPT, pembayaran, login, atau migrasi baru. Persetujuan Founder (`approveRecommendation`) hanya aturan murni yang menghasilkan peristiwa audit; belum disimpan (lihat keputusan Founder).

## Modul (`lib/tax-opt/`)
| File | Isi |
|---|---|
| `schemes.ts` | PPh Final UMKM, PPh Badan umum, Pasal 31E; jenis badan, tanggal terdaftar, jangka waktu, omzet gabungan seluruh PT, pengecualian; fasilitas final tidak digabung dengan 31E/umum |
| `expenses.ts` | kandidat biaya (server, API AI, domain, iklan, gateway, bank, gaji, lain); bukti, kaitan usaha, akun, perlakuan fiskal, verifikasi; deteksi ganda |
| `credits.ts` | bukti potong/setoran; pajak final bukan kredit; bukti ganda, dugaan bayar ganda, klaim ganda ditolak |
| `ppn.ts` | aktif hanya jika PKP terverifikasi; tanpa nomor faktur ditolak, tidak dilengkapi otomatis |
| `notices.ts` | STP/SKPKB/SKPKBT/SKPLB/SKPN; selisih, kekurangan dokumen, jalur resmi dan tenggat; tidak menyimpulkan surat salah |
| `simulation.ts` | pajak sebelum penyesuaian → setelah koreksi fiskal → setelah fasilitas → kredit → estimasi akhir; penghematan bukan jaminan |
| `decision.ts` | persetujuan Founder (hanya jika semua angka TERVERIFIKASI), peristiwa audit |
| `model.ts` | gabungan engine untuk dasbor; daftar butir terbuka |

## Integrasi
- Fase C: ringkasan hanya memakai hasil rekonsiliasi (`pendingAdjustments`, status entitas). Paket Coretax mendapat `csv/optimasi-pajak.csv`, baris README dan blok `optimization` di manifest; berkas lain tidak berubah (diuji dengan hash).
- Fase D: butir terbuka optimasi menjadi penghalang `OPTIMIZATION_OPEN` pada langkah rekonsiliasi fiskal; langkah rekonsiliasi fiskal dan perhitungan membawa tautan ke halaman.

## Dasar hukum (diverifikasi 2026-10-27, halaman resmi DJP)
| ID | Peraturan | Pasal | Masa berlaku / catatan |
|---|---|---|---|
| L1 | UU PPh (UU 7/1983 jo. UU 7/2021) | 17(1)b | tarif 22%, tahun pajak 2022+ |
| L2 | UU PPh | 31E(1) | pengurangan tarif 50% untuk peredaran bruto s.d. Rp50 miliar atas bagian Rp4,8 miliar; rumus porsi diturunkan dari uraian DJP, bukan kutipan pasal |
| L3 | PP 20/2026 (mengubah PP 55/2022) | I angka 3-6; II angka 1 huruf e | 22 Apr 2026; PT/CV/firma bukan subjek baru PPh final, hanya peralihan |
| L4 | PP 55/2022 | 59 (lama) | ukuran jangka waktu peralihan |
| L5 | UU PPh; PP 20/2026 | 6(1); 9(1) (teks tidak dibaca); 20A | biaya; Pasal 9 perlu konfirmasi |
| L6 | UU PPh | 28 | kredit pajak; pajak final tidak dikreditkan |
| L7 | UU KUP; PMK 118/2024 | 25, 27 | keberatan (3 bulan sejak surat dikirim), banding |
| L8 | UU KUP | 36 | pengurangan/penghapusan sanksi (update halaman 16 Jan 2025) |
| L9 | UU PPN; informasi DJP | 9 (teks tidak dibaca) | PKP, SPT Masa PPN |

Tahun pajak di luar 2022-2026: tidak dihitung. Parameter hukum selalu tanpa pemverifikasi sampai akuntan/konsultan mengisinya, sehingga hasil maksimal SIMULASI.

## Keterbatasan yang diakui
- Teks primer peraturan (PP 20/2026 LN 2026/43, Pasal 9 UU PPh, UU PPN, KUP) tidak dapat diambil langsung dari lingkungan ini; semua dari halaman DJP. Konfirmasi akuntan wajib.
- Batas waktu banding tidak diperoleh dari halaman yang dibaca: tidak dihitung.
- Cara menghitung tahun pertama jangka waktu final ambigu: tahun batas ditandai PERLU VERIFIKASI.
- Semua data adalah DEMO. `?skenario=contoh` adalah skenario fiktif berlabel.
