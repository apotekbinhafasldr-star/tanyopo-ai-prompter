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
- Tidak ada pengiriman SPT, pembayaran, login, atau migrasi baru. Persetujuan Founder: lihat bagian E.1 di bawah.

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


## Phase E.1: verifikasi hukum dan persetujuan Founder permanen

### Status verifikasi pasal
Daftar P1-P13 ada di `lib/tax-opt/verification.ts` dan tampil di halaman Optimasi. Status: TERVERIFIKASI_PRIMER, TERVERIFIKASI_SEBAGIAN, SEKUNDER_DJP (hanya panduan DJP), HISTORIS_DIHAPUS (ketentuan lama yang sudah dihapus; tidak pernah dipakai menghitung), BLOCKED (naskah tidak terbaca). Yang BLOCKED atau sekunder tidak pernah dianggap terverifikasi; angka yang bergantung padanya tetap SIMULASI atau PERLU VERIFIKASI AKUNTAN. Kelayakan PT Tanyopo tidak ditetapkan: data perusahaan belum terverifikasi.

### Penyimpanan persetujuan (migrasi 20261027130000, belum diterapkan)
- Tabel `tax_opt_decisions`: append-only, berantai hash per subjek. Tidak ada grant INSERT/UPDATE/DELETE; UPDATE, DELETE, TRUNCATE ditolak trigger.
- Satu jalur tulis: fungsi SECURITY DEFINER `tax_opt_record_decision`, EXECUTE hanya `service_role`. Memeriksa Super Admin aktif dari tabel `finance_platform_admins` (bukan email), kunci advisory per subjek, `expected_seq` (konflik TO409), `request_id` idempoten, hash/versi aturan yang dilihat vs sekarang (TO412).
- Menyimpan: ID keputusan, ID pemutus, waktu, jenis rekomendasi, tahun pajak, versi aturan, hash data hitung, keputusan+alasan, rujukan bukti (kode pendek, bukan URL/jalur), rujukan verifikasi akuntan. Tidak menyimpan nominal atau isi dokumen.
- Status efektif diturunkan: bila hash perhitungan atau versi aturan berubah, persetujuan lama tidak berlaku sampai ditinjau ulang. Koreksi/pencabutan = peristiwa baru (REVOKED).
- Cakupan selalu INTERNAL_RECOMMENDATION_ONLY. Persetujuan tidak mengubah status verifikasi angka, tidak menggantikan akuntan/konsultan pajak, dan tidak membuat laporan siap lapor.
- Trigger anti-eskalasi pada `finance_platform_admins`: tidak ada promosi diri atau pemberian hak oleh staf.
- Rollback `supabase/rollback/20261027130000_*.down.sql` menolak jalan jika sudah ada keputusan.

### Aplikasi
`lib/tax-opt/approval.ts` (hash), `lib/tax-opt/decision.ts` (aturan sebelum DB, pemutus selalu dari sesi server), `services/tax-optimization-approvals.ts` (rpc, gagal tertutup), route `POST /admin/finance/tax/optimization/decision` (flag, origin sama, `tax.optimization.approve`). Selama data masih DEMO, route menolak menyimpan (422 DEMO).

### Pengujian
`supabase/tests/tax-approvals/` (SQL, konkurensi, rollback, kontrol negatif) dijalankan di PostgreSQL 16 lokal dan di CI job `tax-approvals-pg17` (PostgreSQL 17). Tes TS: `tests/unit/tax-opt/approval.test.ts`, `tests/unit/migrations/tax-approvals.test.ts`, `tests/unit/admin/tax-decision-route.test.ts`.


### E.1 remediasi akhir (27 Okt 2026)
- **Pasal 59 PP 55/2022 historis**: PP 20/2026 Pasal I angka 6 berbunyi "Pasal 59 dihapus." (tanpa pengganti). Status P5 = HISTORIS_DIHAPUS. Peralihan hanya lewat Pasal II ayat (1) huruf e dan contoh Penjelasannya (CV AB terdaftar 20 Juni 2023, final sampai TP 2026; tahun terdaftar dihitung).
- **Perubahan mesin**: PT biasa tidak lagi dihitung otomatis pada tahun mana pun (selalu PERLU VERIFIKASI AKUNTAN, tanpa angka), karena lama jangka waktunya berasal dari pasal yang dihapus dan tidak ada contoh resmi untuk PT. CV/firma dihitung otomatis berdasarkan contoh resmi itu (4 tahun pajak, tahun terdaftar dihitung). Koperasi melewati tahun ke-4 ditandai PERLU VERIFIKASI (kelanjutan bersyarat belum dimodelkan).
- **Pasal 31E ayat (1) dan (2)** kini terbaca dari naskah resmi JDIH UU 36/2008 (L11). Belum: Penjelasan 31E dan konfirmasi tidak diubah UU 11/2020 atau UU 7/2021.
- **Tetap BLOCKED/DJP-saja**: Pasal 28 (BLOCKED), tarif 22% Pasal 17 (naskah UU 7/2021 JDIH terpotong sebelum Pasal 17), PPN dan PMK 81/2024. Setiap butir menampilkan "Dokumen yang dibutuhkan".
- **Keamanan**: hash peristiwa kini mencakup jenis rekomendasi, tahun, rujukan bukti, rujukan akuntan, status angka, butir terbuka, dan cakupan; mengganti bukti secara diam-diam terdeteksi `tax_opt_verify_chain`. Tes SQL 64 pemeriksaan.
