# Kesiapan SEO / GEO / AEO

Tanggal audit: 2026-11-11 (audit ulang atas `main` 6287160 ada di bagian 5). Dua cakupan terpisah: (1) situs publik LINOE, (2) fitur SEO/GEO/AEO untuk pelanggan.

Aturan copy: tidak ada janji ranking Google, tidak ada janji sitasi otomatis oleh AI. LINOE hanya menyusun rencana dan data terstruktur dari data milik pelanggan.

Label status: CODE READY (kode selesai, belum dijalankan lokal) dan UNIT TEST PASS hanya boleh dinyatakan setelah CI hijau (lihat PR). Tidak ada MOCK/SANDBOX/REAL E2E pada pekerjaan ini.

## 1. Situs publik LINOE

SEO Phase 1/2 (PR #59, #60, #105, #108) tidak diulang. Yang sudah ada: `app/robots.ts`, `app/sitemap.ts`, canonical + Open Graph + Twitter di landing dan halaman legal, JSON-LD Organization / SoftwareApplication / FAQPage (FAQ satu sumber dengan UI), noindex untuk `(auth)`, `/demo`, `/onboarding`, `/admin`, `/ops`, OG image statis di `public/`.

| Area | Temuan | Status |
|---|---|---|
| robots.txt | `allow: /`, `disallow: /api/ /auth/`, sitemap dirujuk. Login/register sengaja tidak di-disallow agar noindex terbaca. | OK, tidak diubah |
| sitemap.xml | `/` + 4 halaman legal (`/privacy /terms /refund /data-deletion`) dari `LEGAL_LINKS`. Tanpa `lastModified` (tidak ada tanggal ubah nyata). | OK |
| Canonical + OG | Ada di landing dan 4 halaman legal; root `metadataBase` dari `getSiteOrigin()` (tidak pernah localhost). | OK |
| JSON-LD | Organization, SoftwareApplication, FAQPage. Tidak ada offers/rating/logo/sosial (sengaja, jujur). | OK. Ditambah node `WebSite` (nama, url, publisher) |
| Indexability area aplikasi | Grup `(app)` (dashboard, produk, kampanye, seo, dst.) belum punya tag noindex; crawler tanpa sesi dialihkan ke `/login` (noindex), jadi aman, tetapi tidak berlapis. | DIPERBAIKI: `robots: noindex,nofollow` di `app/(app)/layout.tsx` |
| Google Search Console | Tidak ada jalur verifikasi. File verifikasi (`google<token>.html`) tidak lolos allowlist `proxy.ts`. | DIPERBAIKI jalur meta tag: `lib/seo/search-console.ts`, dirender di root layout hanya bila `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` berisi token berbentuk benar. Tidak ada token palsu. |
| Legal | 4 halaman memakai `legalMetadata()` dan `LEGAL` (operator, lokasi, email) satu sumber; semua ada di `PUBLIC_PATHS` proxy dan di sitemap. `effectiveDate` sengaja belum diisi (keputusan Founder). | Konsisten |
| FAQ landing | 12 butir, status pembayaran/platform sesuai fakta publik (pembayaran online belum aktif, publikasi iklan berbayar belum otomatis). | Akurat |
| Performa mobile (dinilai dari kode) | Dua gambar hero besar sama-sama `priority` (`hero.tsx` banner desktop 1536x477 dan `hero-visual.tsx` potret) ditambah logo `priority`; di layar kecil salah satunya bisa tersembunyi tetapi tetap di-preload. Aset sumber besar: `linoe-logo-vertical.png` 1,5 MB, `linoe-symbol-official.png` 0,8 MB, OG 0,4 MB (disajikan lewat `next/image`, kecuali OG). Font memakai `next/font` (swap otomatis). | Rekomendasi, belum diubah: ukur LCP nyata (PageSpeed Insights / Lighthouse dari browser HP) sebelum mengubah UI hero. Nilai CWV riil BELUM TERVERIFIKASI (tidak diukur di sini). |

### Butuh persetujuan Founder (tidak diubah)

1. `/llms.txt` (ringkasan situs untuk mesin AI) tidak lolos allowlist `proxy.ts`: path ini akan dialihkan ke `/login`. Rancangan: di `isPublicAsset()` tambah baris exact-match `pathname === "/llms.txt"` (pola sama dengan `/robots.txt`), lalu rute `app/llms.txt/route.ts` yang menyusun teks dari `buildLinoePublicFacts()` + `LEGAL` (hanya fakta publik berlabel TERSEDIA/SEGERA/TARGET). Catatan jujur: `llms.txt` belum standar yang dijamin dipakai mesin pencari mana pun; nilainya spekulatif. Prioritas rendah.
2. Verifikasi GSC lewat file HTML juga butuh entri allowlist; tidak disarankan karena jalur meta tag sudah tersedia tanpa ubah proxy.
3. Tindakan Founder (tanpa laptop): buka Search Console di HP, tambahkan properti URL-prefix, pilih metode "Tag HTML", salin nilai `content`, isi env `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` di pengaturan situs Netlify, deploy ulang, lalu tekan Verifikasi dan kirim `/sitemap.xml`. Env bukan bagian PR ini.

### Catatan FAQPage

Dokumentasi resmi Google menyatakan hasil kaya (rich result) FAQ tidak lagi ditampilkan di Google Search (dinonaktifkan 7 Mei 2026; dokumentasi dihapus 15 Juni 2026). Sumber: https://developers.google.com/search/docs/appearance/structured-data/faqpage, diakses 2026-11-11. FAQPage di landing tetap schema.org yang valid dan tidak merugikan, tetapi jangan dijadikan klaim "tampil di Google". Teks FAQ yang terlihat di halaman tetap bernilai untuk pengguna dan mesin jawaban.

## 2. Fitur SEO / GEO / AEO untuk pelanggan

| EXISTING | BELUM ADA | BUTUH INTEGRASI EKSTERNAL |
|---|---|---|
| Modul SEO & Discovery (`/seo`): project mode WEBSITE dan NO_WEBSITE | Audit crawl halaman situs pelanggan (rekomendasi hanya dari URL + konteks, bukan fetch halaman) | Search Console API (klik, impresi, kueri, posisi nyata): butuh OAuth Google per pelanggan, izin penyedia, belum ada konektor |
| Rekomendasi kata kunci oleh AI (intent + alasan), rekomendasi on-page, content plan, ide konten, hashtag, CTA, channel (bukan data volume) | Generator judul/meta description per halaman produk yang bisa disalin | Volume/kesulitan kata kunci: butuh penyedia berbayar (mis. Google Ads Keyword Planner dengan akun Ads, atau layanan riset kata kunci berbayar); status API belum diverifikasi, jangan dijanjikan |
| AI Search Readiness (AEO + GEO): pertanyaan pelanggan, jawaban maks 2 kalimat yang hanya berdasar fakta pelanggan, konteks entitas, rekomendasi konten, daftar fakta yang kurang | Schema Article / LocalBusiness / Review (sengaja tidak ada: berisiko klaim palsu) | Analitik trafik organik (GA4 Data API): butuh OAuth dan izin pelanggan |
| Pemeriksa fakta pasca-AI: buang angka di luar fakta, klaim jaminan/ranking/testimoni, klaim status produk berlebihan | Ekspor CSV/PDF hasil SEO | Ukuran Core Web Vitals situs pelanggan: PageSpeed Insights API atau CrUX (kunci API Google); belum diverifikasi di sini |
| Profil Brand dan data produk sebagai sumber fakta; disclaimer tidak menjamin tampil di AI | Riwayat versi/perbandingan antar hasil | Pelacakan visibilitas/sitasi di mesin AI: tidak ada sumber data resmi yang dapat diandalkan; jangan dijual sebagai fitur |
| BARU (PR ini): ekspor JSON-LD FAQPage + Product dari hasil AI Search Readiness (salin dari HP, tanpa panggilan AI baru) | `llms.txt` untuk situs pelanggan | Peringkat/SERP tracking: penyedia berbayar |

### Fitur baru: ekspor JSON-LD (nyata, bukan placeholder)

- Lokasi: kartu "Data Terstruktur (JSON-LD) untuk Website Anda" di halaman detail project SEO (`/seo/[id]`), di bawah Pertanyaan Pelanggan.
- Kode: `lib/seo/customer-json-ld.ts` (builder murni), `features/seo/structured-data-export.tsx` (tombol Salin + kotak teks yang bisa dipilih manual), `features/seo/ai-search-readiness-section.tsx` (penyambung).
- Sumber data: hanya `verified_facts` dan `customer_questions` yang sudah tersimpan. Tidak ada panggilan AI baru, tidak ada kuota baru, tidak ada tulis database, tidak ada migrasi, tidak ada jaringan.
- Validasi: FAQPage hanya memuat pertanyaan yang jawabannya lolos pemeriksaan fakta (diperiksa ulang saat ekspor, jadi data lama tidak bocor), maks 10 butir, teks dirapikan dan dibatasi panjangnya. Product hanya nama/deskripsi/kategori dan, bila pelanggan mengisi harga, harga + mata uang; tidak ada ketersediaan, rating, ulasan, SKU, atau sertifikasi. Baris fakta LINOE sendiri (berstatus rencana/target) tidak pernah diekspor. `<`, `>`, `&` di-escape agar aman di dalam tag script.
- Copy di UI: mengingatkan agar isi yang sama tampil di halaman, menyatakan Google tidak lagi menampilkan rich result FAQ, dan tidak menjamin ranking atau kutipan AI.
- Tes: `tests/unit/seo/customer-json-ld.test.ts`, `tests/unit/seo/seo-readiness-site.test.tsx`. Status: UNIT TEST PASS hanya setelah CI hijau.

## 3. Daftar perubahan file

- `app/layout.tsx`: meta verifikasi Google bersyarat.
- `app/(app)/layout.tsx`: noindex untuk area aplikasi.
- `lib/seo/search-console.ts` (baru), `lib/seo/json-ld.ts` (node WebSite, parameter indentasi opsional).
- `lib/seo/customer-json-ld.ts`, `features/seo/structured-data-export.tsx` (baru), `features/seo/ai-search-readiness-section.tsx`.
- Tes baru (2 berkas) dan dokumen ini.
- Tidak disentuh: `proxy.ts`, auth, migrasi, billing, RLS, env, Netlify/Supabase, modul PUBLOE/MITAPENG/UMKMpro, `features/oauth*`.

## 4. Risiko

- Pengiriman GSC bergantung pada env yang diisi Founder; tanpa itu tidak ada efek (aman).
- Tes belum dijalankan lokal (node_modules tidak tersedia di lingkungan kerja); bukti hanya dari CI.
- Nilai LCP/CWV nyata belum diukur.

## 5. Audit ulang 2026-11-11 (main 6287160): kode dan dokumen, kesiapan Search Console dan Ads

Metode: baca kode (`app/sitemap.ts`, `app/robots.ts`, `app/layout.tsx`, metadata halaman, `lib/seo/*`, `proxy.ts`, `netlify.toml`) dan dokumen resmi Google. **Tidak** ada pemeriksaan situs hidup: URL produksi tidak terjangkau dari lingkungan kerja (di luar daftar akses), jadi isi `robots.txt` dan `sitemap.xml` yang benar-benar tersaji **BELUM TERVERIFIKASI**; yang dinilai adalah kode yang menghasilkannya. `node_modules` kosong, sehingga dokumen Next.js di `node_modules/next/dist/docs/` tidak dapat dibaca dan tes tidak dijalankan lokal (bukti hanya dari CI).

### 5.1 Hasil per butir

| Butir | Hasil | Status |
|---|---|---|
| `app/sitemap.ts` | Memuat `/` dan 4 halaman legal dari `LEGAL_LINKS`, URL absolut https, tanpa `lastModified`/`priority`/`changefreq` (tidak ada tanggal ubah nyata; Google tidak memakai priority/changefreq). Origin `/` tanpa garis miring akhir, canonical landing `/` setara (root). Tidak ditemukan bug | OK, tidak diubah |
| `app/robots.ts` | `allow: /`, `disallow: /api/ /auth/`, `sitemap` ke origin yang sama. `/login`, `/register`, `/onboarding`, `/demo`, `/admin`, `/ops` sengaja tidak di-disallow supaya `noindex` terbaca (dokumen Google: halaman yang diblokir robots.txt tidak membuat crawler melihat noindex, dan robots.txt bukan mekanisme menyembunyikan halaman). Tidak ditemukan bug | OK, tidak diubah |
| Metadata halaman publik | Landing: title, description, canonical `/`, OG/Twitter, OG image statis 1200x630. 4 halaman legal: `legalMetadata()` (title, description, canonical sama dengan rute, `index: true`). Root: `metadataBase` dari `getSiteOrigin()` (tidak pernah localhost), `lang="id"` | OK |
| noindex area terautentikasi | `(app)`, `(auth)`, `admin`, `demo`, `onboarding`, `ops/payments` semuanya `robots: { index: false, follow: false }`; kini dijaga tes baru | OK |
| JSON-LD | Organization, WebSite, SoftwareApplication, FAQPage hanya di landing; tanpa offers/rating/logo/sosial | OK |
| Halaman legal publik | Semua ada di `PUBLIC_PATHS` proxy (terbaca tanpa login), di sitemap, memuat operator, lokasi, email. `effectiveDate` belum diisi: tidak ada "Berlaku sejak". Retensi belum ditetapkan dan tenggat hak subjek tidak dijanjikan (lihat LEGAL_PSE_CHECKLIST) | Konsisten; isi hukum: butuh konsultan |
| Aset crawl | `/robots.txt` dan `/sitemap.xml` exact-match di `isPublicAsset()`; `/llms.txt` belum (keputusan Founder, bagian 1) | OK |
| Analitik/konversi | Tidak ada GA4/gtag/GTM/pixel di kode (pencarian 2026-11-11). Tanpa pengukuran, hasil Search Console tidak dapat dikaitkan ke konversi, dan Ads tidak dapat mengukur | Belum ada (sengaja; perlu keputusan dan persetujuan privasi) |
| Domain | `PRODUCTION_ORIGIN` = `*.netlify.app`. Hanya properti URL-prefix yang realistis selama belum ada domain sendiri (properti Domain butuh DNS: kesimpulan dari dokumen Google di bawah, belum diuji) | PERLU KONFIRMASI |

Perbaikan kode di sitemap/robots: **tidak ada**, karena tidak ada bug terverifikasi. Penambahan: `tests/unit/seo/seo-crawl-consistency.test.ts` (UNIT TEST PASS hanya setelah CI hijau) menjaga: setiap tautan legal ada di `PUBLIC_PATHS` proxy dan memakai `legalMetadata` dengan `path` yang sama; URL sitemap unik, satu origin dengan robots, dan tidak terkena disallow; semua area privat tetap noindex dan tidak ada `index: true` di sana.

### 5.2 Temuan di file lain (hanya dilaporkan, tidak diubah)

1. `app/(app)/layout.tsx` dan lainnya sudah benar. Tidak ada temuan metadata yang salah pada halaman publik.
2. Judul halaman aplikasi bercampur bahasa (mis. "Products", "Content", "Pengaturan"). Tidak berdampak SEO (noindex), hanya konsistensi UI.
3. Halaman legal tanpa tanggal berlaku: penilai platform (Meta/TikTok/Google) mungkin mencari tanggal; belum diverifikasi sebagai syarat. Keputusan Founder (F6 di LEGAL_PSE_CHECKLIST).
4. Performa hero (LCP) belum diukur; lihat bagian 1.

### 5.3 Search Console (resmi: [Verify your site ownership](https://support.google.com/webmasters/answer/9008080?hl=en), diakses 2026-11-11)

- Metode Tag HTML, file HTML, GA, GTM hanya untuk properti URL-prefix; properti Domain hanya lewat catatan DNS. **TERVERIFIKASI (resmi)**.
- Verifikasi bertahan selama token masih terbaca di situs: jangan hapus env/meta tag setelah berhasil. **TERVERIFIKASI (resmi)**.
- `noindex` lewat meta robots atau header `X-Robots-Tag` didukung; aturan noindex di robots.txt tidak didukung; halaman yang diblokir robots.txt tidak menampilkan noindex ke crawler: [Block Search Indexing with noindex](https://developers.google.com/search/docs/crawling-indexing/block-indexing), diakses 2026-11-11. **TERVERIFIKASI (resmi)**.
- robots.txt "bukan mekanisme untuk menjaga halaman dari Google": [Robots.txt Introduction](https://developers.google.com/search/docs/crawling-indexing/robots/intro), diakses 2026-11-11. **TERVERIFIKASI (resmi)**.
- Aturan pembuatan sitemap (lastmod hanya bila akurat): dokumen [Build and Submit a Sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap) tidak terbuka (di luar daftar akses). **BELUM TERVERIFIKASI**; kode tidak menaruh `lastModified` sehingga tidak ada risiko tanggal palsu.

### 5.4 Google Ads: BELUM TERVERIFIKASI

Dokumen kebijakan dan persyaratan akun Google Ads tidak diperiksa (tidak ada sumber resmi yang dibuka pada sesi ini). Jangan menganggap halaman legal dan landing saat ini "lolos kebijakan Ads". Pemeriksaan ini dan pembuatan akun/penagihan adalah keputusan dan biaya Founder; tidak dilakukan di sini dan tidak ada iklan dipublikasikan.

### 5.5 Yang benar-benar butuh Founder (semua dari HP)

| # | Tindakan | Syarat/biaya | Kapan |
|---|---|---|---|
| S1 | Putuskan apakah situs publik boleh diindeks sekarang (soft launch undangan) atau menunggu domain sendiri dan keputusan legal (G9). Kode sudah siap untuk indeks (landing + legal) | Tanpa biaya | Sebelum S2 |
| S2 | Buka Search Console di HP, tambah properti URL-prefix, pilih "Tag HTML", salin nilai `content`, isi `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` di pengaturan Netlify, deploy ulang (variabel `NEXT_PUBLIC_` dibaca saat build), tekan Verifikasi, kirim `/sitemap.xml`. Perubahan env di Netlify hanya oleh Founder | Akun Google, gratis | Setelah S1 |
| S3 | Domain sendiri (bila ada): daftarkan di Netlify dan atur `NEXT_PUBLIC_APP_URL`; buat properti baru di Search Console | Biaya domain: keputusan Founder | Opsional |
| S4 | Ukur LCP/CWV dari HP lewat PageSpeed Insights (alat web, gratis) dan kirim hasil | Gratis | Sebelum mengubah hero |
| S5 | Google Ads, GA4, konversi: **tidak wajib untuk soft launch**; tunda sampai ada keputusan privasi (persetujuan, DPA) dan anggaran | Biaya iklan/penagihan: persetujuan Founder | Setelah soft launch |

Tidak ada tindakan SEO lain yang wajib dari Founder untuk soft launch.
