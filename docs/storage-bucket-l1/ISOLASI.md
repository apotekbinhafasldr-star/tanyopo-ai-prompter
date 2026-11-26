# Paket 2 L1 - Bukti isolasi lintas produk

Proyek Supabase `umkmpro-ai` dibagi dengan PUBLOE, MITAPENG, UMKMpro dan Apotek. L1 hanya boleh menyentuh objek milik LINOE.
Bukti di bawah berasal dari pembacaan SQL dan tes (SANDBOX/statis), bukan dari database production (belum pernah diakses).

## Objek yang DIUBAH (seluruhnya milik LINOE, dikenali lewat nama)
| Objek | Perubahan |
|---|---|
| `storage.buckets` id `creative-assets`, `brand-assets`, `generated-content` | `public` true -> false, hanya bila bucket ada, tanpa objek, DAN terbukti milik LINOE (batas, mime = literal Phase 1, tanpa owner/owner_id); bucket senama yang tidak cocok = migrasi berhenti, tidak disentuh |
| policy `storage.objects` "Tenant kelola file marketing miliknya sendiri" | dihapus (diganti empat policy per-perintah) |
| policy `storage.objects` "Tenant baca file marketing miliknya sendiri" | dibuat |
| policy `storage.objects` "Tenant unggah file product-media miliknya sendiri" | dibuat |
| policy `storage.objects` "Tenant ubah file product-media miliknya sendiri" | dibuat |
| policy `storage.objects` "Tenant hapus file product-media miliknya sendiri" | dibuat |

## Objek yang TIDAK diubah
- Bucket `product-media` (baris bucket, flag public, batas ukuran, mime) dan semua objek di dalamnya.
- `file_size_limit` dan `allowed_mime_types` bucket mana pun (itu L1b).
- Bucket dan objek milik pihak lain (bucket apa pun di luar empat nama LINOE tidak disebut migrasi sama sekali). Bucket senama yang sidiknya berbeda dari Phase 1 dianggap bukan milik LINOE: up berhenti, down tidak menyentuhnya.
- Semua policy `storage.objects` selain lima nama LINOE di atas, termasuk milik PUBLOE, MITAPENG, UMKMpro, Apotek. Tidak ada `drop policy` tanpa nama pasti.
- Tabel `public.*` (termasuk `tenants`, `user_profiles` milik UMKMpro), fungsi, trigger, grant/revoke, ekstensi, cron, auth, env, secret, billing.
- Tidak ada `delete`/`insert` data dan tidak ada pembuatan bucket baru.

## Bukti
1. Tes statis `tests/unit/migrations/storage-bucket-l1.test.ts`: satu-satunya `update` adalah `storage.buckets.public`; semua `drop/create policy` hanya pada
   `storage.objects` dengan lima nama di atas; tidak ada `for all`, grant, fungsi, tabel, `delete from`, `insert into`; tidak ada kata publoe/mitapeng/umkmpro/apotek.
2. Sandbox PostgreSQL (`supabase/tests/storage-bucket-l1/run-local.sh`, log `SANDBOX_LOG.txt`): skenario S12 menambah tiga policy "pihak lain"; md5 policy itu identik
   sebelum migrasi, sesudah migrasi, dan sesudah down.
3. `PRECHECK.sql` Q6 / `POSTCHECK.sql` P6: md5 seluruh policy lain pada `storage.objects` dicatat sebelum dan dibandingkan sesudah (dijalankan Founder nanti).
4. Bundel QA (`qa/qa2-schema-manifest.json`): migrasi ini masuk `excluded` (grup `storage`); bundel QA tidak pernah memuatnya.

## Batas kepemilikan bucket
Nama bucket saja bukan bukti kepemilikan (proyek dibagi). Bukti yang dipakai: sidik Phase 1 (file_size_limit, allowed_mime_types, tanpa owner/owner_id). Ini bukti kuat tetapi bukan mutlak
(pihak lain bisa saja membuat bucket dengan nilai identik). PRECHECK Q2:<bucket> mencetak batas, mime, created_at dan owner untuk ditinjau Founder sebelum apa pun.

## Batas bukti (jujur)
Skema `storage` pada sandbox adalah stub; perilaku Supabase Storage nyata (pemilik tabel, trigger internal, API upload) tidak diuji. Itu UNKNOWN sampai PRECHECK/POSTCHECK
dan uji manual P10 dijalankan Founder dengan persetujuan.
