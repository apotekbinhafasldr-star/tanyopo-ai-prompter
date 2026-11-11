# Kesiapan Peluncuran Meta Ads (One-Click Ads)

Tanggal dokumen: 2026-11-11. Semua rujukan dokumentasi resmi Meta diakses pada tanggal itu.

> **Mock bukan nyata.** Seluruh tes di repositori ini (termasuk "mock E2E") memakai connector palsu dan basis data palsu. Tidak ada satu pun yang pernah memanggil `graph.facebook.com`, memakai akun iklan nyata, atau mengeluarkan uang. Lulus tes mock **tidak** membuktikan Meta menerima permintaan kita. Kode ini belum pernah dijalankan terhadap akun iklan Meta nyata.

## 1. Status saat ini (berlabel)

| Area | Label | Catatan |
|---|---|---|
| Alur peluncuran (persetujuan, Budget Guard, klaim, 4 objek PAUSED) | UNIT TEST PASS | Semua objek dibuat `PAUSED`. Persetujuan Owner wajib. |
| Gerbang S1 (`BUDGET_WRITE_ENABLED_PLATFORMS`) | TERKUNCI (sengaja) | Tidak diubah. Selama terkunci, peluncuran ke Meta ditolak sebelum klaim. |
| Satuan budget IDR | BELUM TERVERIFIKASI | Lihat bagian 4. `meta-budget-units.ts` tetap `verified: false`. |
| Versi API | CODE READY (belum dites nyata) | Dinaikkan dari v21.0 ke v25.0. |
| Backoff rate limit | UNIT TEST PASS | Hanya untuk panggilan non-create. |
| `require_approval_above` | UNIT TEST PASS | Sekarang dipakai di jalur pengajuan dan peluncuran Meta. |
| Budget total / `end_time` | UNIT TEST PASS (sebagian) | Lihat bagian 3. |
| Panggilan nyata ke Meta | EXTERNAL BLOCKED | Butuh izin Meta (bagian 5) dan akun uji. |
| Siap pelanggan | BELUM | Bukan CUSTOMER READY. |

## 2. Hasil verifikasi ulang temuan audit

| # | Temuan audit | Hasil verifikasi di kode terbaru | Tindakan |
|---|---|---|---|
| 1 | `require_approval_above` tidak dipakai | Benar sebelum PR ini. | Diimplementasikan (bagian 3.1). |
| 2 | `total_budget` tidak dikirim ke Meta | Benar: hanya `daily_budget`, tanpa `end_time`. | Sebagian (bagian 3.2). |
| 3 | `meta-campaign-spec` tidak terhubung, negara hard-coded `["ID"]` | Sebagian salah: untuk **Meta**, negara berasal dari `master.target_country` yang divalidasi (`resolveTargetCountry`). `["ID"]` hanya tersisa untuk TikTok dan X. Modul `meta-campaign-spec` memang masih tidak dipakai jalur peluncuran, dan ada tes yang sengaja mengunci itu. | Tidak diubah (bagian 3.5). |
| 4 | Audiens terstruktur belum ada | Benar. Hanya rentang umur yang didukung konektor; peluncuran tidak mengirimnya. Kolom `audience_notes` hanya teks bebas. | Dilaporkan (bagian 6). |
| 5 | Graph v21.0 usang, scope tanpa `pages_*` | Versi: benar, dan lebih buruk dari dugaan. Scope: belum terverifikasi. | Versi diperbarui; scope tidak diubah (bagian 3.4 dan 5). |
| 6 | Tidak ada backoff rate limit | Benar. | Diimplementasikan (bagian 3.3). |
| 7 | Satuan minor IDR belum terverifikasi | Benar, tetap belum terverifikasi. | Tidak diubah (bagian 4). |
| 8 | Panel kesiapan, preview internal, metrik konversi belum ada | Benar. | Dilaporkan (bagian 6). |
| 9 | Query tanpa filter `tenant_id` di `generateOptimizationRecommendationsAction` | Benar untuk tiga query (channel, metrik, konversi). RLS tetap berlaku, ini defense in depth. | Diperbaiki (bagian 3.6). |

## 3. Yang diubah di PR ini

### 3.1 `require_approval_above`

Logika murni di `lib/campaigns/approval-threshold.ts`.

- Campaign "di atas batas" bila budget harian **atau** budget total lebih besar dari ambang. Ambang yang terisi tetapi tidak terbaca (negatif, NaN, bukan angka) dianggap terlampaui (fail closed). Ambang kosong berarti perilaku lama.
- Saat pengajuan (`submitForApprovalAction`): konteks persetujuan menyimpan cuplikan `approval_threshold` (hanya untuk audit).
- Saat peluncuran Meta (`launchChannelCampaignAction`), sebelum klaim dan sebelum panggilan konektor: untuk campaign di atas batas, persetujuan terbaru harus berstatus `APPROVED`, tercatat `decided_by` dan `decided_at` (keputusan Owner yang eksplisit), dan budget harian **dan** total yang tersimpan di persetujuan harus mencakup budget saat ini. Persetujuan lama yang tidak mencatat itu ditolak dan perlu diajukan ulang.
- Ini hanya menambah penolakan. Persetujuan Owner, Budget Guard, gerbang S1, dan validator budget tetap berjalan.
- Batasan: hanya jalur Meta yang membaca baris persetujuan di aksi peluncuran, jadi hanya Meta yang dicek. Jalur TikTok/X tidak berubah.

### 3.2 Budget total dan `end_time`

Sumber resmi (diakses 2026-11-11):

- Referensi Ad Set: <https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-campaign>. `lifetime_budget`: "If specified, you must also specify an `end_time`." `daily_budget`: "allowed only for ad sets with a duration (difference between `end_time` and `start_time`) longer than 24 hours." `end_time`: "required when `lifetime_budget` is specified"; `end_time=0` berarti tanpa akhir. Dokumen tidak menyatakan apakah `daily_budget` dan `lifetime_budget` boleh dikirim bersamaan.
- Budgets: <https://developers.facebook.com/documentation/ads-commerce/marketing-api/bidding/overview/budgets.md>. "The amount you set for bid and budget is at ad account currencies minimum denomination level, such as cents for USD."

Keputusan: LINOE tetap mengirim **satu** budget (budget harian yang disetujui Owner), tidak pernah keduanya.

- `checkTotalBudgetCoverage` (`lib/campaigns/meta-flight.ts`): bila `total_budget` dan `duration_days` terisi, peluncuran ditolak jika `daily_budget x duration_days` melebihi `total_budget`. Ini penegakan di sisi LINOE.
- `resolveMetaFlightEndTime`: menghitung `end_time` (UNIX detik, UTC) dari `start_date` (00:00 WIB) atau sekarang, ditambah `duration_days`. Durasi kurang dari 2 hari, atau data tidak terbaca, berarti tidak ada `end_time` (berjalan terus seperti sebelumnya).
- Konektor Meta menerima `endTimeUnixSeconds` opsional dan mengirim `end_time` bersama `daily_budget`. Nilai tidak valid ditolak sebelum permintaan. Nilai `0` ditolak karena itu penanda "tanpa akhir" milik Meta.
- Belum dilakukan: `lifetime_budget`. Butuh keputusan produk (pacing berbeda dari budget harian yang disetujui) dan tes pada akun uji.
- Celah yang tersisa: campaign dengan `total_budget` tetapi tanpa `duration_days` tidak punya batas akhir dan tidak bisa dicek terhadap total. Ini perlu keputusan produk (mewajibkan durasi).

### 3.3 Backoff rate limit

Modul murni `lib/connectors/meta-rate-limit.ts`, dipakai di `graphFetch`.

Sumber: <https://developers.facebook.com/documentation/ads-commerce/marketing-api/overview/rate-limiting.md> (2026-11-11). Kode 4 (batas aplikasi), 17 (batas akun iklan/pengguna), 613 (beberapa subkode), 80000/80003/80004/80014 (Business Use Case). "Implement exponential backoff when receiving throttling errors." Kode 32 **tidak** tercakup halaman itu: ia dimasukkan atas dasar pengetahuan umum dan belum terverifikasi.

- Dicoba ulang maksimal 2 kali (jeda 1 dtk lalu 2 dtk, batas 5 dtk), hanya untuk respons Meta yang nyata: HTTP 429 atau kode di atas. `Retry-After` dihormati; jika lebih dari 5 detik, tidak menunggu di dalam request.
- Tidak dicoba ulang: kode 613 tanpa subkode (pencegahan penyalahgunaan), subkode 1487632 (perubahan budget ad set, blokir sejam), 1885172, 4841018, 1487225.
- **Panggilan create (campaign, ad set, creative, ad) tidak pernah dicoba ulang.** Meta tidak menyediakan kunci idempotensi, dan rekonsiliasi peluncuran bergantung pada aturan "tanpa percobaan ulang otomatis". Create yang kena throttle dilaporkan sebagai tidak dibuat dan Owner yang memutuskan.

### 3.4 Versi Graph / Marketing API

Sumber: <https://developers.facebook.com/docs/graph-api/changelog/versions> (2026-11-11).

| Versi | Rilis | Kedaluwarsa Marketing API |
|---|---|---|
| v21.0 (pin lama) | 2024-10-02 | 2025-09-09 (sudah lewat) |
| v22.0 | 2025-01-21 | 2026-02-19 (sudah lewat) |
| v23.0 | 2025-05-29 | 2026-06-09 (sudah lewat) |
| v24.0 | 2025-10-08 | 2026-10-06 (sudah lewat) |
| v25.0 | 2026-02-18 | belum ditentukan (TBD) |

Halaman yang sama menyebut Graph API v26.0 dirilis 2026-07-29, tetapi versi Marketing API terbaru yang tercantum adalah v25.0. Karena itu konektor dipin ke **v25.0**.

Alasan mendesak: halaman versioning (<https://developers.facebook.com/docs/marketing-api/overview/versioning>) menyatakan panggilan ke versi yang tidak tersedia "may fail or be upgraded to the next available version", dan endpoint yang terdampak, misalnya `POST /{adset-id}`, **gagal** alih-alih di-upgrade otomatis. Pin v21.0 berarti pembuatan ad set bisa gagal.

Belum terverifikasi: apakah ada perubahan perilaku v22 hingga v25 yang memengaruhi payload kita (campaign, ad set, creative, ad). Periksa changelog Marketing API sebelum uji nyata: <https://developers.facebook.com/documentation/ads-commerce/marketing-api/marketing-api-changelog>.

Catatan: tabel `prompter_platform_capabilities` (di basis data, diisi migrasi) masih mencatat `api_version = v21.0`. Itu butuh migrasi dan tidak disentuh di PR ini (bagian 6).

### 3.5 Spesifikasi audiens dan `meta-campaign-spec`

Tidak diubah. Menghubungkan spek ke jalur peluncuran berarti mengubah tripwire yang sengaja melarangnya, dan audiens terstruktur butuh tempat penyimpanan (kolom atau skema `ai_proposal`) yang bukan lingkup PR ini. Lihat bagian 6.

### 3.6 Filter `tenant_id`

`generateOptimizationRecommendationsAction` kini memakai `.eq("tenant_id", session.tenantId)` pada baca `prompter_channel_campaigns`, `prompter_marketing_metrics`, dan `prompter_conversions` (sebelumnya hanya mengandalkan RLS).

## 4. Satuan minor IDR (belum terverifikasi)

- Budgets: budget memakai "ad account currencies minimum denomination level".
- Currencies (<https://developers.facebook.com/documentation/ads-commerce/marketing-api/currencies.md>, 2026-11-11): IDR beroffset 1, dan "If a currency has an offset of `1`, then the minimum bid equals one base currency unit." Halaman itu membahas **bid**, bukan budget, dan tidak menyebut satuan budget IDR secara eksplisit.
- Kesimpulan: 1 rupiah = 1 satuan budget **sangat mungkin**, tetapi itu inferensi. IDR tetap `verified: false`. Verifikasi butuh uji terkontrol pada akun iklan uji Meta (persetujuan terpisah dari Founder) lalu perubahan kode ber-review pada kedua field.

## 5. Persyaratan di sisi Meta

Sumber: <https://developers.facebook.com/documentation/ads-commerce/marketing-api/get-started/authorization> (2026-11-11).

| Persyaratan | Isi menurut dokumen | Status untuk LINOE |
|---|---|---|
| Akses Standard | Cukup untuk `ads_read` dan `ads_management` pada akun iklan milik sendiri. | Hanya berguna untuk uji pada akun milik sendiri. |
| Advanced Access | "For other people's accounts, you need advanced access to the ads_read and/or ads_management permissions." Disetujui lewat App Review per izin dan fitur. | **Wajib** agar tenant bisa menghubungkan akun iklan mereka. Belum diajukan: EXTERNAL BLOCKED. |
| Business Verification | Diperlukan bila aplikasi mengakses data sensitif; memverifikasi identitas bisnis. | Kemungkinan besar wajib untuk Advanced Access. Halaman rujukan khusus (`access-verification`) tidak dapat dibaca pada 2026-11-11, jadi syarat rinci BELUM TERVERIFIKASI. |
| App Review | Ajukan di App Review > Permissions and Features, "Request advanced access". Butuh penjelasan penggunaan dan screencast. | Belum diajukan. |
| Marketing API Access Tier | Untuk mempertahankan akses Full: minimal 500 panggilan Marketing API dalam 15 hari terakhir dengan tingkat error di bawah 15% dari 500 panggilan terakhir. | Perlu dipantau setelah live. |
| Izin Halaman (`pages_*`) | Halaman otorisasi **tidak** menyebut `pages_read_engagement`, `pages_show_list`, atau `pages_manage_ads`. | BELUM TERVERIFIKASI. Scope saat ini `ads_management, ads_read, business_management, pages_show_list` (dikunci oleh tes dan tidak diubah). Cek kebutuhan izin Page untuk membuat creative pada uji di akun uji sebelum mengajukan App Review. |

Batas laju menurut dokumen yang sama: blokir pada skor maksimum berlangsung 300 detik untuk tier pengembangan dan 60 detik untuk akses Full.

## 6. Butuh persetujuan Founder (tidak dikerjakan di PR ini)

1. **Migrasi**: perbarui `prompter_platform_capabilities.api_version` dari `v21.0` ke `v25.0` untuk baris Meta. Menyentuh `supabase/migrations` dan basis data bersama, jadi harus disetujui dan diterapkan terpisah.
2. **Audiens terstruktur**: butuh keputusan tempat simpan (kolom baru di `prompter_master_campaigns` = migrasi, atau perluasan skema `ai_proposal`). Minat/perilaku Meta memakai ID dari Targeting Search API, jadi tidak boleh dikarang. Usulan awal tanpa minat: jenis kelamin dan rentang umur.
3. **Wajib durasi bila ada budget total** (lihat 3.2), dan keputusan memakai `lifetime_budget`.
4. **Scope OAuth**: tambah `pages_read_engagement` atau `pages_manage_ads` hanya bila uji akun uji membuktikan perlu. Mengubah scope menyentuh alur OAuth dan App Review.
5. **Panel kesiapan, preview internal, metrik konversi**: belum ada. Panel kesiapan dapat memakai hasil `checkApprovalThreshold`, validator budget, dan `getAccountReadinessSnapshot`. Metrik konversi butuh Pixel/CAPI atau kolom baru. Belum dikerjakan agar PR ini kecil dan aman; perlu desain UI.

## 7. Langkah untuk Founder (cukup dari HP Android)

Semua langkah lewat browser Chrome Android. Tidak butuh laptop atau CLI.

1. Buka Meta Business Settings (business.facebook.com) lalu Pusat Keamanan, mulai **Business Verification** untuk PT Tanyopo Future Technology. Siapkan dokumen legalitas (akta/NIB) dalam bentuk foto atau PDF dari HP.
2. Buka developers.facebook.com, aplikasi LINOE, App Review > Permissions and Features. Ajukan **Advanced Access** untuk `ads_management` dan `ads_read` (dan izin Page bila terbukti perlu). Siapkan video layar dari HP yang menunjukkan alur: hubungkan akun, ajukan campaign, persetujuan Owner, objek dibuat PAUSED.
3. Siapkan **akun iklan uji** dan Halaman Facebook uji (bukan akun pelanggan) untuk uji terkontrol satuan budget IDR dan pembuatan objek `PAUSED`. Minta persetujuan eksplisit sebelum gerbang S1 dibuka untuk uji itu.
4. Jangan menghidupkan `PAYMENT_LIVE_ENABLED` dan jangan mengubah `BUDGET_WRITE_ENABLED_PLATFORMS` sampai langkah 1 hingga 3 selesai dan ditinjau.

## 8. Pemblokir eksternal

- Business Verification, App Review, dan Advanced Access Meta: **EXTERNAL BLOCKED** (menunggu Founder dan Meta).
- Akun iklan uji dan akses jaringan ke `graph.facebook.com`: tidak tersedia di lingkungan pengembangan. Tidak ada klaim SANDBOX E2E atau REAL E2E.
