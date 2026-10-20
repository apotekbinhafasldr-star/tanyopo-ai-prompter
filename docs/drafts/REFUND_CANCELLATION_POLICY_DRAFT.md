# DRAFT — Kebijakan Pembatalan dan Pengembalian Dana LINOE

**Status: BLOCKED FOR APPROVAL. Dokumen ini TIDAK dipublikasikan dan tidak ditautkan dari situs mana pun.**
Operator: PT Tanyopo Future Technology. Tidak ada keputusan di bawah yang sudah disetujui Founder atau ditinjau
penasihat hukum. Tanda `[KEPUTUSAN]` berarti Founder harus memutuskan; jangan diisi dengan asumsi.

## 1. Fakta operasional saat ini (terverifikasi dari kode/halaman publik)
- Pembayaran online belum aktif; belum ada penagihan atau transaksi riil (Syarat & Ketentuan bagian 4).
- Masa uji coba gratis 14 hari (`lib/billing/plans.ts`).
- Paket berbayar saat ini hanya daftar harga; Agency berstatus "Segera Hadir".
- Syarat & Ketentuan yang berlaku menyatakan kebijakan pembatalan dan pengembalian dana "ditetapkan terpisah" dan
  "tidak menjanjikan pengembalian dana" sampai diumumkan.
- Penghapusan data ditangani manual (`/data-deletion`).

## 2. Keputusan yang dibutuhkan dari Founder
| # | Pertanyaan | Keputusan |
|---|---|---|
| 1 | Apakah ada refund? Untuk kondisi apa (mis. gagal akses, tagihan ganda, pembatalan awal)? | [KEPUTUSAN] |
| 2 | Jangka waktu pengajuan refund dan jangka waktu pemrosesan (hanya bila benar-benar dapat dipenuhi) | [KEPUTUSAN] |
| 3 | Apakah langganan bulanan dapat dibatalkan kapan saja dan akses berlaku sampai akhir periode? | [KEPUTUSAN] |
| 4 | Apakah ada refund prorata untuk periode berjalan? | [KEPUTUSAN] |
| 5 | Metode pengembalian dana (mengikuti metode bayar asal / kebijakan payment gateway) | [KEPUTUSAN] — bergantung gateway yang dipilih (DOKU/Midtrans) |
| 6 | Saluran pengajuan: email dan telepon resmi yang sudah tercantum? | [KEPUTUSAN] |
| 7 | Penanganan penagihan ganda / transaksi gagal / chargeback | [KEPUTUSAN] |
| 8 | Perubahan harga: pemberitahuan dan dampak ke langganan berjalan | [KEPUTUSAN] |
| 9 | Pajak (PPN) dan bukti pembayaran/invoice | [KEPUTUSAN] — perlu konfirmasi status PKP |
| 10 | Review hukum/penasihat atas teks final | [KEPUTUSAN] |

## 3. Kerangka teks (hanya struktur, tanpa janji)
1. Ruang lingkup: berlaku untuk paket berbayar LINOE setelah pembayaran online aktif.
2. Masa uji coba gratis: tidak ada biaya; tidak ada refund karena tidak ada pembayaran.
3. Pembatalan langganan: `[ISI SETELAH KEPUTUSAN #3]`.
4. Pengembalian dana: `[ISI SETELAH KEPUTUSAN #1, #2, #4, #5]`.
5. Cara mengajukan: email `tanyopofuturetechnology@gmail.com`, telepon `085831815889`.
6. Penagihan ganda dan transaksi gagal: `[ISI SETELAH KEPUTUSAN #7]`.
7. Hubungan dengan Syarat & Ketentuan dan Kebijakan Privasi.

## 4. Sebelum publish (setelah disetujui)
- Terbitkan sebagai halaman publik terpisah (mis. `/refund-policy`) atau perluas bagian 4 Syarat & Ketentuan.
- Tautkan dari footer landing, halaman Harga, dan checkout.
- Ubah kalimat "tidak menjanjikan pengembalian dana" di Syarat & Ketentuan agar konsisten.
- Perbarui tes yang melarang janji waktu respons bila Founder menyetujui jangka waktu tertentu.
