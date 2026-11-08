# Runbook Refund Manual (Midtrans)

Aplikasi **tidak** melakukan refund otomatis. Refund dilakukan manual di dashboard Midtrans, lalu dicatat.
Semua langkah bisa dikerjakan dari HP. Hanya Founder / operator pembayaran yang boleh melakukannya.

## Kapan dipakai
- Pelanggan membayar dua kali atau salah nominal.
- Pembayaran sah tapi layanan tidak bisa diberikan.
- Pembatalan yang disetujui Founder sesuai halaman Kebijakan Refund (`/refund`).

## Sebelum mulai
1. Dapatkan: email pelanggan, nama bisnis, waktu bayar, nominal.
2. Cari transaksinya: ekspor rekonsiliasi di `/ops/payments` (kartu "Ekspor rekonsiliasi") atau lihat kolom Transaksi pada
   alarm. Catat `transaction_id` (= order_id di Midtrans) dan `gateway_transaction_id`.
3. Pastikan statusnya LUNAS dan kolom `check` = `OK`. Jika bukan `OK`, hentikan dan eskalasi ke Founder.
4. Minta persetujuan Founder untuk nominal dan alasan (tulis di catatan).

## Langkah di dashboard Midtrans
1. Buka dashboard Midtrans (environment **Production**) > Transactions.
2. Cari berdasarkan order ID (`transaction_id`).
3. Pastikan nominal dan tanggal cocok dengan catatan.
4. Pilih **Refund**. Isi nominal (penuh atau sebagian) dan alasan singkat. Simpan nomor refund / referensi.
5. Catatan metode bayar: kartu kredit dan beberapa e-wallet mendukung refund langsung; transfer bank / VA biasanya perlu
   pengembalian manual (transfer balik) dengan data rekening pelanggan. Ikuti opsi yang tampil di dashboard.
6. Jangan minta atau simpan nomor kartu / data rekening di chat atau catatan aplikasi.

## Apa yang terjadi di aplikasi
- Midtrans mengirim notifikasi `refund` / `partial_refund`. Aplikasi memverifikasi ke Midtrans lalu membuat **alarm** di
  `/ops/payments` (Refund). Langganan **tidak** dicabut otomatis.
- Jika layanan harus dihentikan, minta Founder memutuskannya; perubahan langganan tidak dilakukan dari halaman ini.

## Pencatatan (wajib)
1. Di `/ops/payments`, buka alarm refund terkait, tekan "Tandai sedang dicek" saat mulai.
2. Setelah selesai, "Selesaikan dengan catatan" (min. 5 karakter) berisi: nomor refund Midtrans, nominal, alasan, siapa yang menyetujui, tanggal.
3. Simpan juga satu baris di catatan keuangan (spreadsheet Founder): tanggal, order_id, nominal, alasan, referensi refund.
4. Refund sebagian: nominal sisa tetap tercatat sebagai pendapatan; jangan menghapus invoice.

## Setelah refund
1. Beri tahu pelanggan (email resmi) bahwa refund diproses dan estimasi dana kembali (tergantung bank, umumnya beberapa hari kerja).
2. Pada ekspor rekonsiliasi berikutnya, cocokkan dengan laporan Midtrans.
3. Jika alarm muncul lagi untuk transaksi yang sama, cek apakah itu refund tambahan atau pengiriman ulang notifikasi sebelum bertindak.

## Jangan
- Jangan refund lewat cara selain dashboard Midtrans resmi.
- Jangan mengubah data langganan / transaksi langsung di database.
- Jangan membagikan Server Key atau tangkapan layar yang memuatnya.
