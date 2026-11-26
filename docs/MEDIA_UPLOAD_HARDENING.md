# Pengerasan unggah foto produk, Paket 2 L2 (flag, default OFF)

**Status: Draft PR. Flag `MEDIA_UPLOAD_HARDENING_ENABLED` default MATI; saat mati perilaku unggah identik dengan sebelum L2. JANGAN dihidupkan sebelum L1 dan penyempitan policy (L1b/L3) selesai.**

## Batas jujur (baca dulu)
- **L2 BUKAN batas keamanan.** Browser mengunggah langsung ke Supabase Storage (bucket `product-media`). Klien yang dimodifikasi dapat mengunggah berkas apa pun tanpa memanggil `recordProductMediaAction`, sehingga pemeriksaan server tidak pernah berjalan.
- Tenant dapat **menimpa/mengganti objek** miliknya setelah diverifikasi, karena policy `storage.objects` yang ada (FOR ALL/UPDATE per folder tenant) mengizinkannya. Verifikasi server hanya foto sesaat.
- Penegakan nyata butuh **L1** (batas ukuran dan MIME di tingkat bucket) dan **penyempitan policy** (**L1b/L3**). Tanpa itu L2 hanya memperbaiki kejujuran UX dan kebersihan data untuk pengguna yang jujur (EXIF/GPS terbuang, nama berkas asli tidak tersimpan, format seragam).
- Ukuran total yang tidak dilaporkan Storage (tanpa `Content-Range`/`Content-Length`) tidak dicek di server; tanda tangan berkas tetap dicek.

## Aturan saat flag AKTIF
| Aspek | Perilaku |
| --- | --- |
| Format masukan klien | JPG, PNG, WebP. HEIC dan lainnya ditolak dengan pesan khusus |
| Batas masukan | 25 MB (`HARDENED_MAX_INPUT_BYTES`), dicek sebelum encode ulang |
| Batas hasil | 8 MB, dicek di klien (setelah encode ulang) dan di server (ukuran objek bila diketahui) |
| Piksel | maks. 150 MP (`MAX_DECODED_PIXELS`), dicek sebelum digambar ke canvas |
| EXIF/metadata | Dibuang lewat encode ulang canvas; `createImageBitmap({ imageOrientation: "from-image" })` membenahi orientasi lebih dulu |
| WebP | Dikonversi ke JPEG di klien (preflight Meta hanya menerima JPG/PNG). Server menolak path/berkas WebP |
| Nama berkas | `<tenant>/<produk>/<uuid-acak>.<jpg|png>`; nama asli tidak tersimpan |
| Verifikasi server | Signed URL + `fetch` ber-`Range` 12 byte pertama, `AbortSignal.timeout(5000)`; cek magic bytes. Gagal/timeout = gagal-tertutup dan objek dihapus |
| Kuota | Maks. 20 foto per produk; hanya baris `media_type = IMAGE` dihitung (video lama tidak memblokir foto baru). Bila hasil pindai mencapai 50 baris, kuota **gagal-terbuka** (unggahan diizinkan) karena hitungan tidak terbukti lengkap |
| Video | Tidak diterima pada mode ini (hanya foto). Keputusan produk: bila video harus tetap bisa diunggah, perlu jalur terpisah |

Angka 20 foto per produk dan jendela pindai 50 baris adalah asumsi implementasi, belum diputuskan Founder.

## Pesan galat (terpisah per sebab)
Berkas > 25 MB; hasil akhir masih > 8 MB; > 150 megapiksel; format tidak didukung (mis. HEIC); peramban belum mendukung (`TypeError` pada `imageOrientation`) vs berkas tidak terbaca; gagal unggah/jaringan; verifikasi server gagal; tanda tangan tidak cocok; kuota tercapai. Tidak ada pesan generik "Kecilkan foto".

## UI (HP Android)
Teks bantuan "Foto besar akan diperkecil otomatis; hasil akhir maks. 8 MB."; target sentuh >= 44 px; satu kolom di layar sempit; galat `role="alert"`; progres `aria-live="polite"`; pratinjau foto; kotak centang pernyataan hak unggah. Bila tombol Unggah nonaktif karena belum dicentang, tampil "Centang pernyataan di bawah ini untuk mengaktifkan tombol Unggah." dan tombol memakai `aria-describedby` ke teks itu.

## Berkas
`lib/media/upload-hardening-flag.ts`, `lib/media/media-upload-validation.ts` (murni), `lib/media/strip-image-metadata.ts`, `lib/media/hardened-upload-server.ts`; diubah: `features/products/actions.ts` (cabang flag di `recordProductMediaAction`), `features/products/media-uploader.tsx` (prop `hardened`), `app/(app)/products/[id]/page.tsx`, `.env.example`.

## Mengaktifkan (hanya setelah persetujuan Founder, langkah terpisah)
1. L1 (batas bucket) dan L1b/L3 (penyempitan policy) selesai, diuji, dan disetujui.
2. Uji perangkat nyata Android (Chrome) di preview: foto kamera besar, PNG transparan, WebP, HEIC (harus ditolak), orientasi EXIF.
3. Di Netlify (persetujuan env terpisah): set `MEDIA_UPLOAD_HARDENING_ENABLED=true`, mulai dari context preview.

## Mematikan / rollback
Kosongkan `MEDIA_UPLOAD_HARDENING_ENABLED` (atau hapus env) lalu deploy ulang; atau revert PR. Objek yang sudah tersimpan tetap valid (path acak tetap berada di folder tenant/produk).
