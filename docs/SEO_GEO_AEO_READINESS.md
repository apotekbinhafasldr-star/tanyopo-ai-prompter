# Kesiapan SEO / GEO / AEO

Tanggal audit: 2026-11-11. Branch: `feat/seo-geo-aeo-readiness`. Dua cakupan terpisah: (1) situs publik LINOE, (2) fitur SEO/GEO/AEO untuk pelanggan.

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

## 3A. Audit sprint 2026-11-15 (main d19232a): apa yang benar-benar terhubung

Dasar: kode di `main`, bukan situs hidup (URL produksi tidak diperiksa; isi yang tersaji BELUM TERVERIFIKASI). Klarifikasi Founder: AEO dan GEO belum terhubung ke situs. Pembuktian dari kode:

| Komponen | Bukti di kode | Status |
|---|---|---|
| JSON-LD (Organization, WebSite, SoftwareApplication, FAQPage) | `lib/seo/json-ld.ts` dirender di `app/(marketing)/page.tsx` (landing saja) | TERHUBUNG; tanpa rating/review/offers/harga (dijaga tes) |
| FAQ (AEO) | `features/marketing/faq-data.ts` satu sumber untuk UI dan FAQPage | TERHUBUNG. Celah: tidak ada jawaban tentang PUBLOE/MITAPENG, sehingga mesin jawaban tidak bisa membedakannya dari LINOE |
| sitemap.xml / robots.txt | `app/sitemap.ts` (`/` + 4 legal), `app/robots.ts` (disallow `/api/` `/auth/`); exact-match di `proxy.ts` | TERHUBUNG, tidak ada bug |
| noindex area privat/demo | layout `(app)`, `(auth)`, `admin`, `demo`, `onboarding`, `ops/payments` | TERHUBUNG |
| llms.txt | Tidak ada `public/llms.txt`. `proxy.ts` hanya mengecualikan `.svg/.png/...` dan path exact tertentu, jadi `/llms.txt` akan dialihkan ke `/login` | TIDAK TERHUBUNG (B) |
| Halaman FAQ/Help terpisah | Tidak ada di `main`; Help Center ada di PR #69 (Draft, belum merge) | TIDAK ADA (jangan diduplikasi) |
| Fitur AEO/GEO pelanggan (`/seo`) | Ada, di dalam aplikasi login; bukan bagian situs publik | Terpisah dari situs publik |

Status A/B/C:

| Kode | Butir | Tindakan |
|---|---|---|
| A (diperbaiki PR ini) | FAQ status PUBLOE/MITAPENG (teks sama dengan `ECOSYSTEM_IN_DEVELOPMENT`; tanpa fitur/harga/tanggal) otomatis masuk FAQPage JSON-LD | `features/marketing/faq-data.ts`; tes `tests/unit/seo/seo-geo-aeo-connection.test.ts` |
| A | Pagar tes: JSON-LD valid tanpa rating/review/offers, sitemap hanya halaman publik, `public/llms.txt` hanya boleh ada bila proxy mengizinkannya | tes yang sama |
| B | Mengaktifkan `llms.txt`: butuh baris exact-match `/llms.txt` di `isPublicAsset()` (`proxy.ts`, gerbang autentikasi: perlu persetujuan Founder) lalu `public/llms.txt` berisi fakta berlabel. Nilai spekulatif, prioritas rendah | tidak diubah |
| B | Domain kanonik final, verifikasi Search Console, DNS | Founder; kode memakai `NEXT_PUBLIC_APP_URL` / `URL` / `PRODUCTION_ORIGIN` (`*.netlify.app`) |
| C | LCP/CWV nyata, isi robots/sitemap yang tersaji di produksi | belum diukur |

Tindakan Founder minimal dari HP: lihat bagian 5.5 pada PR #138 (S1-S2: putuskan boleh diindeks, Search Console tag HTML, isi `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` di Netlify, deploy ulang, kirim `/sitemap.xml`). Perkiraan waktu tidak dicantumkan karena tidak ada bukti.

## 4. Risiko

- Pengiriman GSC bergantung pada env yang diisi Founder; tanpa itu tidak ada efek (aman).
- Tes belum dijalankan lokal (node_modules tidak tersedia di lingkungan kerja); bukti hanya dari CI.
- Nilai LCP/CWV nyata belum diukur.
