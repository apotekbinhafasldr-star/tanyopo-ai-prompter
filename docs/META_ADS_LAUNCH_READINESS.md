# Kesiapan Peluncuran Meta Ads (One-Click Ads)

Tanggal dokumen: 2026-11-11. Semua rujukan dokumentasi resmi Meta diakses pada tanggal itu.
Klaim yang bisa kedaluwarsa (versi API, tier akses, izin, Business Verification) diverifikasi ulang 2026-11-11; hasilnya di bagian 5.1 dan di [INTEGRATIONS_READINESS_MATRIX.md](INTEGRATIONS_READINESS_MATRIX.md).

> **Mock bukan nyata.** Seluruh tes di repositori ini (termasuk "mock E2E") memakai connector palsu dan basis data palsu. Tidak ada satu pun yang pernah memanggil `graph.facebook.com`, memakai akun iklan nyata, atau mengeluarkan uang. Lulus tes mock **tidak** membuktikan Meta menerima permintaan kita. Kode ini belum pernah dijalankan terhadap akun iklan Meta nyata.

## 1. Status saat ini (berlabel)

| Area | Label | Catatan |
|---|---|---|
| Alur peluncuran (persetujuan, Budget Guard, klaim, 4 objek PAUSED) | UNIT TEST PASS | Semua objek dibuat `PAUSED`. Persetujuan Owner wajib. |
| Gerbang S1 (`BUDGET_WRITE_ENABLED_PLATFORMS`) | TERKUNCI (sengaja) | Tidak diubah. Selama terkunci, peluncuran ke Meta ditolak sebelum klaim. |
| Satuan budget IDR | BELUM TERVERIFIKASI | Lihat bagian 4. `meta-budget-units.ts` tetap `verified: false`. |
| Versi API | CODE READY (belum dites nyata) | Dinaikkan dari v21.0 ke v25.0. Perubahan payload v24 (`is_adset_budget_sharing_enabled`) sudah ditambahkan; bagian 3.4. |
| Backoff rate limit | UNIT TEST PASS | Hanya untuk panggilan non-create. |
| `require_approval_above` | UNIT TEST PASS | Sekarang dipakai di jalur pengajuan dan peluncuran Meta. |
| Budget total / `end_time` | UNIT TEST PASS | `end_time` = waktu peluncuran + durasi; kasus tepi ditolak (fail closed). Batas harian Meta bukan batas keras: bagian 3.2. |
| Panggilan nyata ke Meta | EXTERNAL BLOCKED | Butuh izin Meta (bagian 5) dan akun uji. |
| Siap pelanggan | BELUM | Bukan CUSTOMER READY. |

## 2. Hasil verifikasi ulang temuan audit

| # | Temuan audit | Hasil verifikasi di kode terbaru | Tindakan |
|---|---|---|---|
| 1 | `require_approval_above` tidak dipakai | Benar sebelum PR ini. | Diimplementasikan (bagian 3.1). |
| 2 | `total_budget` tidak dikirim ke Meta | Benar: hanya `daily_budget`, tanpa `end_time`. | Diimplementasikan di sisi LINOE (bagian 3.2). Audit lanjutan: `end_time` versi pertama dihitung dari `start_date`, padahal ad set tidak mengirim `start_time`; diperbaiki. |
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
- `resolveMetaFlightEndTime` (diperbaiki setelah audit): `createAdSet` **tidak** mengirim `start_time`, sehingga ad set mulai segera setelah diaktifkan, apa pun `start_date`. Versi pertama menghitung `end_time` dari `start_date` (00:00 WIB), sehingga `start_date` di masa depan membuat iklan berjalan melebihi `duration_days` (dan `total_budget`). Kini `end_time = waktu peluncuran (dibulatkan ke bawah ke detik) + duration_days x 86.400 detik`. `start_date` tidak lagi menjadi masukan. Hitungan memakai detik berlalu (UNIX UTC), jadi zona waktu dan batas hari kalender tidak berpengaruh; pembulatan hanya memajukan akhir.
- Fail closed, dihitung **sebelum klaim** (tidak ada objek dibuat, status tidak berubah): `duration_days` terisi tetapi bukan bilangan bulat 2 sampai 365 (1 hari tidak memenuhi aturan Meta "longer than 24 hours" untuk budget harian; di atas 365 atau tak terbaca dulu diam-diam menjadi "tanpa akhir"); `total_budget` terisi tetapi `duration_days` kosong (pengeluaran harian tidak bisa dibatasi; ini menutup celah yang sebelumnya dicatat). Keduanya kosong tetap berarti perilaku lama (tanpa `end_time`).
- Konsekuensi yang disengaja: ad set dibuat `PAUSED` dan baru berjalan saat diaktifkan, lalu `end_time` tetap dihitung dari saat peluncuran. Aktivasi yang ditunda hanya **memperpendek** masa tayang, tidak pernah memperpanjang. Ad set tidak menunggu `start_date` di masa depan (perilaku ini sudah demikian sebelum PR ini).
- Konektor Meta menerima `endTimeUnixSeconds` opsional dan mengirim `end_time` bersama `daily_budget`. Nilai tidak valid ditolak sebelum permintaan. Nilai `0` ditolak karena itu penanda "tanpa akhir" milik Meta.
- Anggaran: budget yang dikirim <= budget harian master <= budget harian yang disetujui (`resolveMetaLaunchBudget`), dan `checkTotalBudgetCoverage` menolak `daily x durasi > total_budget`.
- **Risiko tersisa (BELUM TERVERIFIKASI penuh): budget harian Meta bukan batas keras.** Changelog Marketing API v24.0 (<https://developers.facebook.com/docs/graph-api/changelog/version24.0>, 2026-11-11): "Daily budget flexibility is increasing from 25% to 75%"; pembacaan ringkasan halaman menyebut pengeluaran mingguan tidak melebihi 7x budget harian. Halaman Budgets (<https://developers.facebook.com/documentation/ads-commerce/marketing-api/bidding/overview/budgets.md>) masih menyebut 25% dan tidak menyebut batas mingguan; kedua sumber berbeda dan tidak dapat didamaikan. Dicek ulang 2026-11-11: halaman Budgets masih hanya menyebut "up to 25% more than your daily budget"; tidak ada "75%" atau batas mingguan di sana, jadi ketidakcocokan itu tetap terbuka. Akibatnya total pengeluaran sungguhan bisa melebihi `daily x durasi` pada hari-hari tertentu, terutama untuk durasi di bawah 7 hari. Penyangga yang kokoh hanya `lifetime_budget` + `end_time`, yang belum dikerjakan (butuh keputusan Founder dan tes pada akun uji, bagian 6).

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

Dibaca ulang 2026-11-11: tabel tidak berubah (tidak ada versi setelah v26.0; Marketing API v25.0 kedaluwarsa "TBD"; Graph API v25.0 kedaluwarsa 2028-07-29). Halaman yang sama menambahkan "Marketing API version auto-upgrade will release on July 29, 2026", dan halaman versioning menyatakan "The current version of the Marketing API is v25.0" serta dukungan versi sebelumnya "at least 90-days". Jadi v25.0 masih benar sebagai pin. Changelog v26.0 (`.../changelog/version26.0`) tidak terbaca (client_error), sehingga dampak v26.0 pada Marketing API BELUM TERVERIFIKASI; tidak perlu dinaikkan selama tabel menyebut v25.0 sebagai Marketing API terbaru.

Alasan mendesak: halaman versioning (<https://developers.facebook.com/docs/marketing-api/overview/versioning>) menyatakan panggilan ke versi yang tidak tersedia "may fail or be upgraded to the next available version", dan endpoint yang terdampak, misalnya `POST /{adset-id}`, **gagal** alih-alih di-upgrade otomatis. Pin v21.0 berarti pembuatan ad set bisa gagal.

#### Audit kompatibilitas v25.0 (2026-11-11)

Sumber yang berhasil dibaca (WebFetch, 2026-11-11): tabel versi <https://developers.facebook.com/docs/graph-api/changelog/versions>; changelog <https://developers.facebook.com/docs/graph-api/changelog/version22.0>, `.../version23.0`, `.../version24.0`, `.../version25.0` (masing-masing memuat bagian Graph API dan Marketing API); panduan <https://developers.facebook.com/documentation/ads-commerce/marketing-api/bidding/guides/adset-budget-sharing>; referensi Ad Set <https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-campaign>. Halaman `marketing-api-changelog/versionNN.0` dan referensi `ad-campaign-group` **tidak terjangkau** (di luar allowlist atau gagal). Isi changelog dibaca lewat ringkasan WebFetch, bukan salinan penuh.

| Panggilan | Hasil | Status |
|---|---|---|
| URL dialog OAuth (`/v25.0/dialog/oauth`) | Hanya segmen versi yang berubah. Changelog Graph v22 sampai v25 tidak memuat perubahan Login/OAuth. | Changelog: tidak ada perubahan. Dokumen Facebook Login sendiri BELUM TERVERIFIKASI. |
| Tukar token (`/oauth/access_token`, `fb_exchange_token`), `debug_token`, `/me/permissions` | Tidak ada perubahan tercantum v22 sampai v25. Satu-satunya perubahan lintas-node di v25: parameter `metadata=1` dihentikan; kita tidak memakainya. | Changelog: tidak ada dampak. |
| `/me/adaccounts`, `/me/accounts`, `/{act_id}` (`id,name,account_status,currency,is_prepay_account,funding_source,min_daily_budget`) | Tidak ada penghapusan field ini di changelog yang terbaca. Referensi tingkat field tidak dibaca. | BELUM TERVERIFIKASI (tingkat field). |
| `POST /{act}/campaigns` | **Berubah di v24.0**: `is_adset_budget_sharing_enabled` wajib bila budget diatur di level ad set; bila dihilangkan Meta menolak dengan error 4834011. Kita memakai budget ad set. **Diperbaiki**: konektor kini mengirim `false` (tanpa berbagi budget antar ad set; tidak mengubah budget). Pembuatan Advantage+ shopping/app campaign dihentikan sejak v24/v25 dan `smart_promotion_type` dihapus di v25; kita tidak mengirimnya. | Perbaikan: UNIT TEST PASS. Diterima Meta: BELUM DIUJI NYATA. Nilai `false` dipilih konservatif; panduan tidak menjelaskan perilaku `false` saat pembuatan. |
| `POST /{act}/adsets` | `daily_budget`, `end_time` (tanpa `start_time`), `bid_strategy=LOWEST_COST_WITHOUT_CAP`, `billing_event=IMPRESSIONS` konsisten dengan referensi Ad Set. v23.0: ad set baru default ikut Advantage+ Audience (usia/jenis kelamin bisa menjadi saran, jangkauan bisa melampaui rentang). v24.0: fleksibilitas budget harian 25% ke 75% (lihat 3.2). | Dampak Advantage+ Audience pada `age_min/age_max` kita BELUM TERVERIFIKASI (parameter opt-out tidak dibaca); dicatat sebagai risiko, tidak diubah. |
| `POST /{act}/adcreatives` | Perubahan v22 (`instagram_actor_id` diganti `instagram_user_id`, bundel `STANDARD_ENHANCEMENTS`, Segment Asset Customization) tidak menyangkut payload kita (`object_story_spec.link_data`, `picture`, `call_to_action`). | Tidak ada dampak yang terlihat; field-level BELUM TERVERIFIKASI. |
| `POST /{act}/ads` | Tidak ada perubahan tercantum yang relevan. | Tidak ada dampak yang terlihat. |
| `GET /{campaign}/insights` (`spend,impressions,reach,clicks`) | Penghapusan metrik di v25/v26 hanya untuk Page, Post, Video, dan Stories Insights. Field kerja asinkron baru tidak kita pakai. | Tidak ada dampak. |

Pembulatan: yang terbukti hanyalah "tidak ada perubahan relevan yang tercantum di changelog yang terbaca" ditambah satu perubahan nyata (v24 budget sharing) yang sudah diperbaiki. Itu bukan bukti Meta menerima payload; hanya uji pada akun uji yang membuktikannya.

Catatan: tabel `prompter_platform_capabilities` (di basis data, diisi migrasi) masih mencatat `api_version = v21.0`. Itu butuh migrasi dan tidak disentuh di PR ini (bagian 6).

### 3.5 Spesifikasi audiens dan `meta-campaign-spec`

Tidak diubah. Menghubungkan spek ke jalur peluncuran berarti mengubah tripwire yang sengaja melarangnya, dan audiens terstruktur butuh tempat penyimpanan (kolom atau skema `ai_proposal`) yang bukan lingkup PR ini. Lihat bagian 6.

### 3.6 Filter `tenant_id`

`generateOptimizationRecommendationsAction` kini memakai `.eq("tenant_id", session.tenantId)` pada baca `prompter_channel_campaigns`, `prompter_marketing_metrics`, dan `prompter_conversions` (sebelumnya hanya mengandalkan RLS).

### 3.7 Verifikasi tidak melemahkan gerbang (setelah audit)

- OAuth: `getAuthorizationUrl` dan `exchangeCodeForToken` tidak berubah selain segmen versi pada `DIALOG_BASE_URL` dan `GRAPH_BASE_URL`; `SCOPES` tetap, dan `features/oauth*` tidak disentuh.
- `require_approval_above` fail closed: ambang terisi tetapi tak terbaca dianggap terlampaui (`lib/campaigns/approval-threshold.ts:76`); pemeriksaan berjalan sebelum klaim (`features/campaigns/launch-actions.ts:563`, klaim di baris 793).
- Gerbang S1: `lib/campaigns/external-budget-guard.ts` tidak diubah (selisih nol terhadap `main`); `evaluateExternalBudgetWrite` tetap dipanggil sebelum klaim (baris 381 dan 718).
- Tidak ada jalur publish/aktivasi baru: semua pembuatan objek Meta tetap `status: "PAUSED"` (`lib/connectors/meta-connector.ts:524, 587, 647`); creative tidak punya status. Penolakan `end_time` dan durasi terjadi sebelum klaim (baris 592 vs 793), jadi tidak ada objek dibuat dan status tidak berubah.

## 4. Satuan minor IDR (belum terverifikasi)

- Budgets: budget memakai "ad account currencies minimum denomination level".
- Currencies (<https://developers.facebook.com/documentation/ads-commerce/marketing-api/currencies.md>, 2026-11-11): IDR beroffset 1, dan "If a currency has an offset of `1`, then the minimum bid equals one base currency unit." Halaman itu membahas **bid**, bukan budget, dan tidak menyebut satuan budget IDR secara eksplisit.
- Kesimpulan: 1 rupiah = 1 satuan budget **sangat mungkin**, tetapi itu inferensi. IDR tetap `verified: false`. Verifikasi butuh uji terkontrol pada akun iklan uji Meta (persetujuan terpisah dari Founder) lalu perubahan kode ber-review pada kedua field.

## 5. Persyaratan di sisi Meta

Sumber: <https://developers.facebook.com/documentation/ads-commerce/marketing-api/get-started/authorization> (2026-11-11).

| Persyaratan | Isi menurut dokumen | Status untuk LINOE |
|---|---|---|
| Standard Access (istilah baru: "Limited Access") | Cukup untuk `ads_read` dan `ads_management` pada akun iklan milik sendiri. Halaman otorisasi (2026-11-11) mencatat pembaruan Mei 2026: "'Standard Access' is now Limited Access"; Limited: "Heavily rate-limited per ad account. For development only." | Hanya berguna untuk uji pada akun milik sendiri. |
| Advanced Access | "For other people's accounts, you need advanced access to the ads_read and/or ads_management permissions." Disetujui lewat App Review per izin dan fitur. | **Wajib** agar tenant bisa menghubungkan akun iklan mereka. Belum diajukan: EXTERNAL BLOCKED. |
| Business Verification | Halaman otorisasi: diperlukan bila aplikasi mengakses data sensitif. Halaman izin (<https://developers.facebook.com/docs/permissions>, 2026-11-11): "Business Verification is required for all apps making requests for Advanced Access." | **Wajib** untuk Advanced Access (VERIFIED dari dokumen resmi, bukan lagi dugaan). Daftar dokumen yang diminta Meta dan lama prosesnya BELUM TERVERIFIKASI (halaman rinci tidak terjangkau). |
| App Review | Ajukan di App Review > Permissions and Features, "Request advanced access". Butuh penjelasan penggunaan dan screencast. | Belum diajukan. |
| Marketing API Access Tier | Tier yang tertulis kini Limited access (otomatis saat produk Marketing API ditambahkan) dan Full access (butuh App Review). Syarat 500 panggilan dalam 15 hari terakhir dengan tingkat error di bawah 15% dari 500 panggilan terakhir berlaku untuk **mempertahankan Advanced Access dan untuk naik ke Full** (ambang Full diturunkan dari 1.500 ke 500). | Perlu dipantau setelah live. |
| Izin Halaman (`pages_*`) | Halaman otorisasi tidak menyebut izin Page, tetapi halaman izin (2026-11-11) mencantumkan **dependensi** `ads_management`: `pages_read_engagement` dan `pages_show_list`; `pages_manage_ads` (membuat dan mengelola iklan yang terkait Page) bergantung pada `pages_show_list`. | **Temuan baru:** scope saat ini `ads_management, ads_read, business_management, pages_show_list` (dikunci oleh tes dan tidak diubah) tidak memuat `pages_read_engagement`. Apakah itu menggagalkan pembuatan creative pada akun nyata BELUM TERBUKTI; buktikan di akun uji. Mengubah scope butuh persetujuan Founder (bagian 6 butir 4). |

Batas laju menurut halaman rate limiting (2026-11-11): blokir pada skor maksimum berlangsung 300 detik untuk Limited access (skor maks 60) dan 60 detik untuk Full access (skor maks 9000). Kode 32 tetap tidak tercakup halaman itu.

### 5.1 Verifikasi ulang klaim yang bisa kedaluwarsa (2026-11-11)

| Klaim | Hasil | Sumber |
|---|---|---|
| Marketing API terbaru v25.0; v24.0 kedaluwarsa 2026-10-06 | MASIH BENAR | <https://developers.facebook.com/docs/graph-api/changelog/versions>, <https://developers.facebook.com/docs/marketing-api/overview/versioning> |
| Advanced Access wajib untuk akun orang lain; Standard cukup untuk akun sendiri | MASIH BENAR, istilah "Standard" kini "Limited Access" | <https://developers.facebook.com/documentation/ads-commerce/marketing-api/get-started/authorization> |
| Business Verification | DIPERBARUI: wajib untuk Advanced Access | <https://developers.facebook.com/docs/permissions> |
| Dependensi izin Page | DIPERBARUI: ada, lihat baris di atas | <https://developers.facebook.com/docs/permissions> |
| Backoff dan kode galat | MASIH BENAR (kode 32 belum terverifikasi) | <https://developers.facebook.com/documentation/ads-commerce/marketing-api/overview/rate-limiting.md> |
| Satuan budget IDR | TETAP BELUM TERVERIFIKASI | <https://developers.facebook.com/documentation/ads-commerce/marketing-api/bidding/overview/budgets.md> |
| Waktu proses App Review dan daftar dokumen Business Verification | BELUM TERVERIFIKASI (halaman rinci di luar akses sesi) | tidak ada |

## 6. Butuh persetujuan Founder (tidak dikerjakan di PR ini)

1. **Migrasi**: perbarui `prompter_platform_capabilities.api_version` dari `v21.0` ke `v25.0` untuk baris Meta. Menyentuh `supabase/migrations` dan basis data bersama, jadi harus disetujui dan diterapkan terpisah.
2. **Audiens terstruktur**: butuh keputusan tempat simpan (kolom baru di `prompter_master_campaigns` = migrasi, atau perluasan skema `ai_proposal`). Minat/perilaku Meta memakai ID dari Targeting Search API, jadi tidak boleh dikarang. Usulan awal tanpa minat: jenis kelamin dan rentang umur.
3. **Keputusan memakai `lifetime_budget` + `end_time`** sebagai batas keras total, atau mewajibkan `budget total >= budget harian x durasi x faktor fleksibilitas Meta` (lihat risiko di 3.2). Kewajiban durasi saat ada budget total sudah diterapkan di sisi peluncuran Meta (3.2); input form belum mewajibkannya, sehingga Owner baru melihat penolakan saat meluncurkan.
4. **Scope OAuth**: dokumen izin Meta mencantumkan `pages_read_engagement` sebagai dependensi `ads_management` (bagian 5). Tambah `pages_read_engagement` atau `pages_manage_ads` hanya bila uji akun uji membuktikan perlu. Mengubah scope menyentuh alur OAuth dan App Review.
5. **Panel kesiapan, preview internal, metrik konversi**: belum ada. Panel kesiapan dapat memakai hasil `checkApprovalThreshold`, validator budget, dan `getAccountReadinessSnapshot`. Metrik konversi butuh Pixel/CAPI atau kolom baru. Belum dikerjakan agar PR ini kecil dan aman; perlu desain UI.

## 7. Langkah untuk Founder (cukup dari HP Android)

Semua langkah lewat browser Chrome Android. Tidak butuh laptop atau CLI.

1. Buka <https://business.facebook.com/settings/security> (Pusat Keamanan; label menu Meta bisa berubah dan belum dicek di sesi ini), mulai **Business Verification** untuk PT Tanyopo Future Technology. Siapkan dokumen legalitas (akta/NIB) dalam bentuk foto atau PDF dari HP.
2. Buka <https://developers.facebook.com/apps/>, pilih aplikasi LINOE, App Review > Permissions and Features (tautan langsung: `https://developers.facebook.com/apps/<APP_ID>/app-review/permissions/`, isi `<APP_ID>` dari daftar aplikasi; bentuk URL belum dicek). Ajukan **Advanced Access** untuk `ads_management` dan `ads_read` (dan izin Page bila terbukti perlu). Siapkan video layar dari HP yang menunjukkan alur: hubungkan akun, ajukan campaign, persetujuan Owner, objek dibuat PAUSED.
3. Siapkan **akun iklan uji** dan Halaman Facebook uji (bukan akun pelanggan) untuk uji terkontrol satuan budget IDR dan pembuatan objek `PAUSED`. Minta persetujuan eksplisit sebelum gerbang S1 dibuka untuk uji itu.
4. Jangan menghidupkan `PAYMENT_LIVE_ENABLED` dan jangan mengubah `BUDGET_WRITE_ENABLED_PLATFORMS` sampai langkah 1 hingga 3 selesai dan ditinjau.

## 8. Pemblokir eksternal

- Business Verification, App Review, dan Advanced Access Meta: **EXTERNAL BLOCKED** (menunggu Founder dan Meta).
- Akun iklan uji dan akses jaringan ke `graph.facebook.com`: tidak tersedia di lingkungan pengembangan. Tidak ada klaim SANDBOX E2E atau REAL E2E.
