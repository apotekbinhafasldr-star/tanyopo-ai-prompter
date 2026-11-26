# Paket 2 L1 - Laporan risiko

## R1 (TINGGI, TIDAK DITUTUP L1): policy pihak lain tanpa bucket_id
Postgres menggabungkan policy PERMISSIVE dengan OR. Bila ada policy pihak lain pada `storage.objects` (milik PUBLOE/MITAPENG/UMKMpro/Apotek atau bawaan) yang
mengizinkan tulis (`ALL`/`INSERT`/`UPDATE`/`DELETE`) untuk `public`/`authenticated` **tanpa menyebut `bucket_id`**, maka tenant LINOE tetap bisa menulis ke
bucket cadangan walau bucketnya privat dan policy LINOE sudah dipersempit. Ini bukan kelemahan L1 melainkan di luar kuasanya: L1 sengaja tidak menyentuh policy pihak lain
(isolasi lintas produk). Sandbox S12 membuktikan perilakunya: tenant A masih berhasil menulis ke `creative-assets` lewat policy semacam itu.
- Deteksi: PRECHECK Q0 (LANJUT-DENGAN-CATATAN dengan teks eksplisit; BERHENTI bila policy pihak lain menyebut bucket LINOE), POSTCHECK P9 (PASS-DENGAN-CATATAN bila daftar sama dengan Q0, TINJAU bila ada yang baru).
- Tindak lanjut: butuh keputusan pemilik produk terkait dan Founder (mis. mempersempit policy itu, atau L1b/L3). Tidak dikerjakan di L1.

## R2: hak role migrasi pada storage (UNKNOWN)
`storage.objects` dan `storage.buckets` dimiliki `supabase_storage_admin`. Pipeline production memakai `linoe_migrator` tanpa hak istimewa. Jika role itu tak boleh
`drop/create policy` atau `update storage.buckets`, migrasi gagal utuh (tanpa efek). PRECHECK Q7 melaporkan pemilik dan hak. Paket production baru (di samping `p0-2`) diperlukan nanti;
**tidak dibuat di PR ini** (hanya didokumentasikan di PR dan di sini).

## R3: UPDATE product-media dipertahankan
Kode memakai `upload(..., { upsert: false })` dan `remove()`; tidak ada `update`/`move`/`copy` (diverifikasi ulang: `features/products/media-uploader.tsx`, `actions.ts`, `launch-actions.ts` hanya list/remove/upload).
Policy UPDATE dipertahankan di L1 agar tidak ada risiko regresi; penutupan di L1b/L3.

## R4: bucket cadangan berhenti publik
Tidak ada kode yang membaca bucket cadangan (hanya `product-media` lewat `publicStorageUrl`). URL publik bucket cadangan akan berhenti bekerja; karena bucket harus kosong, tak ada yang terdampak.

## R5: hitungan objek dan perlombaan
`DROP POLICY` mengambil kunci tabel `storage.objects` (diverifikasi di sandbox S8), lalu objek dihitung dalam transaksi yang sama. Unggahan serentak ke bucket cadangan tidak bisa menyelip di antara hitungan dan perubahan,
dengan syarat kunci didapat (`lock_timeout` 3 detik; bila tidak, migrasi gagal tanpa efek). Objek multipart yang belum selesai (tabel internal Supabase) tidak dihitung: UNKNOWN.

## R6: down tidak persis semula bila keadaan awal berbeda
Down memulihkan `public = true` seperti Phase 1. Bila production ternyata berbeda (dicatat PRECHECK Q2), ikuti ROLLBACK.md langkah 4.

## Rencana PRECHECK production yang aman (belum disetujui; tidak dijalankan)
1. Founder menyetujui PRECHECK secara eksplisit. 2. Jalankan `PRECHECK.sql` (satu SELECT) di SQL Editor dari HP; kirim hasil tanpa token/data pelanggan.
3. Putuskan: Q0 BERHENTI/Q4 > 0/Q8 BERHENTI = berhenti; LANJUT-DENGAN-CATATAN = lanjut dengan R1 dicatat. 4. Penerapan butuh persetujuan terpisah dan paket production baru.
5. Setelah terapan: `POSTCHECK.sql` dengan nilai PRECHECK diisi di CTE `ref`, lalu uji manual P10 memakai akun QA tetap (tanpa menempel token).
