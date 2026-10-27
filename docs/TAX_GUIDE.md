# Panduan Lapor Pajak Coretax (Phase D)

Route: `/admin/finance/tax/guide` (di dalam Admin Center, di belakang `ADMIN_CENTER_ENABLED`, izin server `tax.view`).
Query: `jenis=pph-badan|ppn|lainnya`, `tahun=YYYY`, `langkah=N` (semua divalidasi; nilai tak dikenal diabaikan).

## Isi
- Pilihan jenis: SPT Tahunan PPh Badan, SPT Masa PPN (hanya jika PKP terverifikasi), kewajiban masa lainnya (hanya jika diverifikasi akuntan; saat ini kosong).
- Wizard: 15 langkah (PPh Badan) / 12 langkah (PPN), checklist, progress bar, Sebelumnya/Lanjut, daftar langkah, penjelasan tiap langkah.
- Kesiapan (`lib/tax-guide/readiness.ts`): selalu **BELUM SIAP LAPOR** sampai tidak ada penghalang (data DEMO, aktivitas PT lain belum masuk, pemeriksaan gagal, rekonsiliasi bank belum final, laporan belum disahkan, koreksi fiskal belum diverifikasi, tarif belum diverifikasi, PKP belum diverifikasi, data Faktur Pajak belum ada). Data segmen LINOE tidak pernah dianggap laporan seluruh PT.
- Langkah 8 memakai route paket Coretax yang sudah ada (POST, server-side `tax.export` + `accounting.view`, audit log).

## Sumber resmi (dibaca 2026-10-27)
| ID | Halaman DJP | Tanggal di halaman |
|---|---|---|
| S1 | Coretaxpedia: Lapor SPT Tahunan Badan, pajak.go.id/coretaxpedia/lapor-spt-tahunan-badan | Diperbarui 27 Nov 2025 |
| S2 | SPT Masa Coretax DJP, pajak.go.id/en/node/107920 | Update 06/10/2025 |
| S3 | Meski SPT PPN Nihil, PKP Tetap Wajib Lapor, pajak.go.id/en/node/119028 | 19 Jan 2026 |
| S4 | SPT Badan: Lapor Sekarang atau Ajukan Perpanjangan, pajak.go.id/en/node/119763 | 30 Apr 2026 |

Tiap langkah berlabel **Sesuai sumber resmi / Sebagian terverifikasi / Belum terverifikasi**. Yang belum terverifikasi tidak dikarang; UI memberi peringatan agar mengikuti layar Coretax, Coretaxpedia, KPP, atau akuntan.

Belum terverifikasi dari sumber yang dibaca: prosedur BPE, langkah PPN di Coretax (menu, pembayaran, tanda tangan), kode otorisasi, tanggal batas SPT Masa PPN, syarat teknis akun Coretax. Satu artikel DJP lain (e-form 1771 / DJP Online, 2025) sengaja tidak dipakai karena untuk tahun pajak sebelum Coretax.

## Keamanan
- Tidak ada kolom input teks/password/OTP; tidak ada penyimpanan server baru; tidak ada migrasi baru.
- Kemajuan checklist hanya boolean + nomor langkah di `localStorage` perangkat ini (kenyamanan per pengguna, bisa kosong/diblokir). Tidak dikirim ke server.
- "Tandai selesai" butuh dua bukti resmi dicentang dan tetap hanya catatan lokal: bukan bukti pelaporan.
- Tidak login, tidak mengirim SPT, tidak membayar; tautan ke portal resmi dibuka di tab baru (`noopener noreferrer`).
- Halaman memakai data DEMO; tidak ada angka rupiah di halaman panduan.
