# Paket 2 L1 - Rollback dari HP (Jalur A / B / C)

Status: **belum diterapkan ke database mana pun.** Berkas: migrasi `supabase/migrations/20261126100000_prompter_storage_bucket_l1.sql`,
down `supabase/rollback/20261126100000_prompter_storage_bucket_l1.down.sql`. Semua langkah di bawah bisa dilakukan dari browser HP
(GitHub mobile untuk menyalin SQL, Supabase Dashboard > SQL Editor). Tidak ada langkah yang butuh laptop. Setiap eksekusi di production
butuh persetujuan Founder terpisah; dokumen ini tidak memberi izin apa pun.

## Jalur A - L1 belum diterapkan
Tidak ada yang perlu dipulihkan. Tutup/ubah PR. Database tidak pernah berubah.

## Jalur B - L1 sudah diterapkan, bucket cadangan tetap kosong (kasus normal)
1. Dengan persetujuan Founder, jalankan isi `.down.sql` di SQL Editor (satu transaksi; `lock_timeout` 3 detik, gagal = tidak ada perubahan).
2. Efek: tiga bucket cadangan kembali `public = true`; policy `FOR ALL` "Tenant kelola file marketing miliknya sendiri" kembali; empat policy baru L1 dihapus.
   Tidak menyentuh objek, batas ukuran/mime, bucket `product-media`, atau policy pihak lain. Aman dijalankan ulang.
3. Verifikasi: jalankan `supabase/tools/storage-bucket-l1/PRECHECK.sql` lagi. Harapan: Q8 = `lama=1; baru=0` (LANJUT), Q6 sama dengan nilai yang
   dicatat sebelum L1, Q1 sama dengan Q1 sebelum L1, Q2 `md5_batas_mime_empat_bucket` sama.
4. Bila PRECHECK Q2 sebelum L1 mencatat bahwa salah satu bucket cadangan ternyata sudah `public = false` (bukan keadaan Phase 1), down TIDAK persis
   semula untuk bucket itu: balikkan flag-nya secara manual sesuai catatan Q2, dengan persetujuan.

## Jalur C - ada objek di bucket cadangan (migrasi menolak, atau objek muncul kemudian)
- Migrasi berhenti dengan pesan `L1 BERHENTI: N objek ...` dan **tidak mengubah apa pun** (satu transaksi). Itu perilaku yang benar, bukan kegagalan.
- Jangan hapus atau pindahkan objek untuk "meloloskan" migrasi. Karantina/penghapusan hanya dengan **persetujuan khusus per kelas dan jumlah**
  (kelas = bucket + jenis berkas; jumlah = hasil PRECHECK Q4), dengan rencana pemulihan objek, dan bukan bagian L1.
- Down script tidak pernah menghapus objek, jadi rollback tidak mengubah keadaan objek di Jalur C.
- Setelah persetujuan khusus dan tindakan terpisah, jalankan ulang PRECHECK (Q4 harus 0) baru L1 dipertimbangkan lagi.

## Bila ada kegagalan izin
Migrasi memakai `drop/create policy` pada `storage.objects` dan `update storage.buckets`. Pemilik tabel itu di Supabase adalah `supabase_storage_admin`;
apakah `linoe_migrator` atau `postgres` boleh mengubahnya = **UNKNOWN** sampai PRECHECK Q7 dijalankan. Bila gagal karena izin, tidak ada yang berubah
(transaksi dibatalkan); laporkan pesan error apa adanya dan jangan memberi role tambahan tanpa persetujuan terpisah.
