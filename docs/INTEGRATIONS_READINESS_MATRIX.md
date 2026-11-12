# Matriks kesiapan integrasi: Meta, TikTok, X, DOKU

Status: **DOKUMEN (Draft)**. Tanggal verifikasi dan akses dokumentasi resmi: **2026-11-11** (basis `main` `6287160`).
Tidak ada perubahan kode, env, migrasi, billing, atau infrastruktur oleh dokumen ini. Tidak ada panggilan ke API platform; hanya halaman dokumentasi publik yang dibaca.
**Tidak ada integrasi di sini yang berstatus LIVE.** Tidak ada REAL E2E dan tidak ada CUSTOMER READY untuk satu pun platform.

Dokumen rinci per platform (tidak diulang di sini): [META_ADS_LAUNCH_READINESS.md](META_ADS_LAUNCH_READINESS.md), [TIKTOK_INTEGRATION.md](TIKTOK_INTEGRATION.md), [X_INTEGRATION.md](X_INTEGRATION.md), [DOKU_E2E_SANDBOX_RUNBOOK.md](DOKU_E2E_SANDBOX_RUNBOOK.md). Checklist Founder umum: [FOUNDER_CHECKLIST_HP.md](FOUNDER_CHECKLIST_HP.md).

## 1. Legenda status

| Label | Arti di dokumen ini |
|---|---|
| CODE READY | Kode ada dan lulus tes unit (fetch/DB palsu). Belum pernah menyentuh platform nyata |
| MOCK | Alur lengkap lulus dengan konektor/gateway tiruan (MOCK E2E). Bukan bukti platform menerima permintaan |
| SANDBOX | Lulus di lingkungan uji milik penyedia atau database sandbox. Hanya dipakai bila ada buktinya; cakupan ditulis di kolom catatan |
| REAL | Lulus terhadap akun/platform nyata. **Belum ada satu pun** |
| EXTERNAL BLOCKED | Butuh izin, verifikasi, review, kredit, atau tindakan dari pihak penyedia atau Founder. Kode tidak bisa menyelesaikannya |
| BELUM TERVERIFIKASI | Dokumentasi resmi tidak terbaca atau tidak menyebutkannya. Tidak ditebak |

Satu baris bisa memuat dua label (mis. CODE READY untuk kode, EXTERNAL BLOCKED untuk pemakaian nyata).

## 2. Meta (Facebook/Instagram Ads)

| Kemampuan | Status | Catatan dan bukti | Sumber (diakses 2026-11-11) |
|---|---|---|---|
| OAuth (dialog, tukar token) | CODE READY; pemakaian nyata EXTERNAL BLOCKED | Segmen versi `v25.0`. Changelog Graph v22 sampai v25 tidak memuat perubahan Login (dokumen Facebook Login sendiri tidak terbaca: BELUM TERVERIFIKASI) | https://developers.facebook.com/docs/graph-api/changelog/versions |
| Versi Marketing API | CODE READY (pin v25.0) | v25.0 = terbaru, kedaluwarsa "TBD"; v24.0 kedaluwarsa 2026-10-06; Graph v26.0 ada (2026-07-29) tetapi Marketing API terbaru tetap v25.0; changelog v26.0 tidak terbaca | https://developers.facebook.com/docs/graph-api/changelog/versions ; https://developers.facebook.com/docs/marketing-api/overview/versioning |
| Izin `ads_read`, `ads_management`, `business_management`, `pages_show_list` | CODE READY (diminta di scope); Advanced Access EXTERNAL BLOCKED | `ads_management` mencantumkan dependensi `pages_read_engagement` dan `pages_show_list`. Scope kode belum memuat `pages_read_engagement`: dampak BELUM TERBUKTI, perlu uji akun uji | https://developers.facebook.com/docs/permissions |
| Advanced Access | EXTERNAL BLOCKED | Wajib untuk akun iklan milik orang lain; Standard (kini "Limited Access", pembaruan Mei 2026) hanya untuk akun sendiri. Syarat 500 panggilan dalam 15 hari dengan error di bawah 15% untuk mempertahankan Advanced Access dan naik ke Full | https://developers.facebook.com/documentation/ads-commerce/marketing-api/get-started/authorization |
| Business Verification | EXTERNAL BLOCKED | "Business Verification is required for all apps making requests for Advanced Access." Daftar dokumen dan lama proses: BELUM TERVERIFIKASI | https://developers.facebook.com/docs/permissions |
| App Review | EXTERNAL BLOCKED | Per izin; butuh screencast ujung ke ujung ("Upload a screencast showing the end-to-end user experience"). Lama proses BELUM TERVERIFIKASI | https://developers.facebook.com/documentation/instagram-platform/app-review |
| Peluncuran campaign (campaign, ad set, creative, ad, semua `PAUSED`) | MOCK | Persetujuan Owner, Budget Guard, ambang persetujuan, `end_time`. Gerbang S1 (`BUDGET_WRITE_ENABLED_PLATFORMS`) sengaja terkunci | (dokumen internal, lihat META_ADS_LAUNCH_READINESS) |
| Payload v24+ (`is_adset_budget_sharing_enabled=false`) | CODE READY; diterima Meta BELUM DIUJI | Perubahan v24.0 sudah diterapkan di kode | https://developers.facebook.com/docs/graph-api/changelog/versions |
| Backoff rate limit | CODE READY | Kode 4, 17, 613 (subkode tertentu), 80000 series; kode 32 tidak tercakup halaman resmi; create tidak pernah diulang. Blokir 300 dtk (Limited, skor maks 60) / 60 dtk (Full, skor maks 9000) | https://developers.facebook.com/documentation/ads-commerce/marketing-api/overview/rate-limiting.md |
| Satuan budget IDR | BELUM TERVERIFIKASI | Halaman Budgets: "minimum denomination level"; IDR tidak disebut. Fleksibilitas harian di sana masih "25%" (changelog v24 menyebut 75%): tidak damai | https://developers.facebook.com/documentation/ads-commerce/marketing-api/bidding/overview/budgets.md |
| Panggilan nyata ke Meta | EXTERNAL BLOCKED | Tidak ada akun iklan uji, tidak ada akses jaringan dari lingkungan pengembangan | (n/a) |

## 3. TikTok

| Kemampuan | Status | Catatan dan bukti | Sumber (diakses 2026-11-11) |
|---|---|---|---|
| Developer account dan app (Open API v2) | EXTERNAL BLOCKED | Ikon 1024x1024, deskripsi, URL privasi/ketentuan, redirect URI https. App yang dibuat setelah 2024-09-09 wajib verifikasi URL; app yang memakai upload URL Content Posting wajib verifikasi tanpa memandang tanggal | https://developers.tiktok.com/doc/getting-started-create-an-app |
| Login Kit (OAuth Open API v2) | CODE READY (klien, belum terpasang); UI "Menunggu Persetujuan Penyedia"; pemakaian nyata EXTERNAL BLOCKED | URL otorisasi `https://www.tiktok.com/v2/auth/authorize/`, `scope` dipisah koma, tanpa PKCE di halaman web. Token akses 24 jam, refresh 365 hari dan berotasi | https://developers.tiktok.com/doc/login-kit-web ; https://developers.tiktok.com/doc/oauth-user-access-token-management |
| App review (scope `user.info.basic`, `video.upload`, `video.publish`) | EXTERNAL BLOCKED | "several days to two weeks"; tanpa persetujuan tidak ada akses API. Demo video maks 5 berkas, masing-masing maks 50 MB | https://developers.tiktok.com/doc/getting-started-faq ; https://developers.tiktok.com/doc/getting-started-create-an-app |
| Sandbox TikTok | Belum dicoba (butuh Founder) | "try out integrations without having to submit your app for review"; terbatas | https://developers.tiktok.com/doc/getting-started-create-an-app |
| Content Posting API: Direct Post dan Upload (inbox) | CODE READY (klien, belum terpasang); posting nyata EXTERNAL BLOCKED | Init 6/menit per token (diverifikasi di halaman referensi Direct Post). Konfigurasi Direct Post harus diaktifkan di app dan `video.publish` disetujui | https://developers.tiktok.com/doc/content-posting-api-reference-direct-post ; https://developers.tiktok.com/doc/content-posting-api-get-started |
| Audit Content Posting | EXTERNAL BLOCKED | Tanpa audit: semua konten privat (`SELF_ONLY`), maks 5 pengguna per 24 jam, semua akun privat. Setelah audit batas posting kira-kira 15 per hari per kreator. Formulir dan prosedur audit rinci: BELUM TERVERIFIKASI | https://developers.tiktok.com/doc/content-sharing-guidelines |
| Penjadwalan posting | BELUM TERVERIFIKASI di API; rancangan antrean LINOE | Parameter jadwal tidak terbaca di endpoint init | https://developers.tiktok.com/doc/content-posting-api-get-started |
| Ads API (Marketing API: konektor, retry, pemetaan galat) | CODE READY (UNIT TEST PASS); pemakaian nyata EXTERNAL BLOCKED | Auth, umur token, review, kode galat, batas laju: BELUM TERVERIFIKASI (portal dokumen Marketing API di luar akses sesi; halaman bantuan hanya menyebut mendaftar sebagai developer) | https://ads.tiktok.com/help/article/marketing-api |

## 4. X

| Kemampuan | Status | Catatan dan bukti | Sumber (diakses 2026-11-11) |
|---|---|---|---|
| OAuth 2.0 Authorization Code + PKCE | CODE READY; saklar `X_OAUTH_PKCE_WIRED=false` (fail-closed); pemakaian nyata EXTERNAL BLOCKED | `code_challenge` (S256/plain) wajib di URL otorisasi; kode kedaluwarsa 30 dtk; `state` maks 500 karakter. Badan penukaran kode dan skema header klien rahasia: BELUM TERVERIFIKASI (uji sandbox) | https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code.md |
| Scope | CODE READY | `tweet.read tweet.write users.read media.write offline.access`. Tanpa `offline.access` tidak ada refresh token, token akses 2 jam | https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code.md |
| API posting (`POST /2/tweets`) | CODE READY (belum tersambung ke UI/aksi); `PUBLISH_CONTENT` nonaktif | Teks, 1 sampai 4 media. Panjang teks maks tidak tercantum. Kutipan post (`quote_tweet_id`) hanya Enterprise. Penjadwalan tidak ada di sisi X | https://docs.x.com/x-api/posts/create-post.md |
| Unggah media v2 | CODE READY | initialize/append/finalize; harga unggah media tidak tercantum | https://docs.x.com/x-api/fundamentals/rate-limits |
| Rate limit | CODE READY (patuh yang paling ketat) | `POST /2/tweets` 100/15 menit per pengguna dan 10.000/24 jam per app (halaman rate-limits) vs 200/15 menit dan 300/3 jam (halaman manage-tweets): tidak konsisten, pakai 100/15 menit | https://docs.x.com/x-api/fundamentals/rate-limits ; https://docs.x.com/x-api/posts/manage-tweets/integrate |
| Biaya API dan kredit | EXTERNAL BLOCKED (butuh kredit dari Founder) | Bayar-per-pakai, tanpa langganan: buat post US$0,015; buat post berisi URL US$0,200; buat post "summoned" US$0,010; baca post US$0,005; baca milik sendiri US$0,001; baca user US$0,010. Tier Free/Basic/Pro tidak ada di halaman; Enterprise untuk volume lebih tinggi. Angka = snapshot, cek Developer Console | https://docs.x.com/x-api/getting-started/pricing.md |
| X Ads API (iklan) | TIDAK DIDUKUNG (fail-closed); EXTERNAL BLOCKED | Host `ads-api.x.com`, OAuth 1.0a, butuh aplikasi yang disetujui untuk Ads API; skema DB hanya menyimpan access/refresh token (butuh migrasi) | https://docs.x.com/x-ads-api/fundamentals/making-authenticated-requests.md |
| Developer account dan App | EXTERNAL BLOCKED | Console: New App, terima Developer Agreement; kredensial hanya tampil sekali | https://docs.x.com/fundamentals/developer-portal.md |

## 5. DOKU (pembayaran)

| Kemampuan | Status | Catatan dan bukti | Sumber (diakses 2026-11-11) |
|---|---|---|---|
| Adapter, webhook, verifikasi, alert | MOCK (UNIT TEST PASS, MOCK E2E PASS) | Gateway tiruan; CI `main` hijau menurut runbook. Bukan bukti DOKU nyata | (internal) |
| Skema DB sandbox T6..T17 | SANDBOX (hanya skema/fungsi DB, bukan pembayaran) | Runner `DOKU Sandbox Runner` run #4 dan #5 sukses menurut runbook | (internal) |
| Merchant (registrasi, KYB) | EXTERNAL BLOCKED | KYB 2x24 hari kerja; dokumen bervariasi; akun mulai di mode sandbox; kredensial produksi diganti di Service Management. Kode pos merchant sedang diperbaiki DOKU, belum ada konfirmasi | https://dashboard.doku.com/docs/docs/getting-started/register-business |
| Checkout sandbox (VA, QRIS, e-wallet, kartu) | Belum ada SANDBOX E2E (butuh Founder: situs Netlify sandbox, user uji, simulator) | Simulator `https://sandbox.doku.com/integration/simulator/`; channel yang bisa disimulasikan tidak disebut. `order.currency` opsional di request Checkout (default IDR) | https://developers.doku.com/accept-payments/doku-checkout/integration-guide/simulate-payment-and-notification.md ; https://developers.doku.com/accept-payments/doku-checkout/integration-guide/backend-integration.md |
| Webhook sandbox | MOCK; SANDBOX belum ada | Notification URL per channel (Settings, Payment Settings), publik, tanpa auth/VPN, ngrok tidak didukung. Wajib 2xx; 3 percobaan ulang (30 mnt, 6 jam, 12 jam); kirim ulang manual | https://developers.doku.com/get-started-with-doku-api/notification/setup-notification-url.md ; https://developers.doku.com/get-started-with-doku-api/notification/retry-notification.md |
| Check Status (sumber aktivasi) | MOCK; B-CUR terbuka | Panggil 60 dtk setelah bayar. `order.currency` tidak terdokumentasi di respons: kode fail-closed (PAID tanpa `currency` ditolak) | https://dashboard.doku.com/docs/docs/http-notification/check-status-non-snap |
| Refund | Manual (tanpa kode otomatis); alert REFUND MOCK; nyata EXTERNAL BLOCKED | Bank maks 10 hari kerja, maks Rp25.000.000; e-wallet DOKU 3 hari kerja; biaya Rp2.500 (e-wallet) dan Rp6.500 (bank) di luar PPN; refund non-kartu menyetor dana ke DOKU dan kirim instruksi API. Prosedur setoran vs tiket DOKU Care belum didamaikan | https://docs.doku.com/accept-payments/finance-and-settlement/refund-and-chargeback/refund-and-chargeback |
| Chargeback | Tidak ada jalur pencatatan (P1-F); EXTERNAL BLOCKED | Hanya permintaan dari acquirer diproses; agregator memotong dari settlement berikutnya | idem |
| Settlement | EXTERNAL BLOCKED | Tidak ada settlement untuk bisnis yang belum terverifikasi; T+1 sampai T+4 menurut channel, hari kerja 12:00-14:00 WIB | https://docs.doku.com/accept-payments/finance-and-settlement/settlement-time |
| Rekonsiliasi | CODE READY (ekspor CSV `/ops/payments`); kolom nomor invoice DOKU belum ada (P1-E); pencocokan dengan laporan nyata EXTERNAL BLOCKED | Laporan settlement via Dashboard, Reports, Settlements (format kolom tidak disebut) | https://docs.doku.com/get-started/manage-business/manage-reports/settlement-report |
| Pembayaran nyata | EXTERNAL BLOCKED | `PAYMENT_LIVE_ENABLED` tetap OFF; adapter DOKU hanya punya host sandbox | (internal) |

## 6. Klaim yang diverifikasi ulang (hasil ringkas)

| Platform | Masih benar | Diperbarui atau baru | Tetap belum terverifikasi |
|---|---|---|---|
| Meta | Pin v25.0, tabel versi, Advanced Access untuk akun orang lain, backoff, budget 25% | Business Verification wajib untuk Advanced Access; dependensi `pages_read_engagement`; "Standard" kini "Limited Access"; syarat 500 panggilan juga untuk mempertahankan Advanced Access; auto-upgrade versi 2026-07-29 | Dokumen Facebook Login, changelog v26.0, daftar dokumen Business Verification, lama App Review, satuan budget IDR |
| TikTok | Token 24 jam / 365 hari, URL otorisasi, audit dan batas privat, 6 init per menit, review media | Review "several days to two weeks"; verifikasi URL (app setelah 2024-09-09); halaman rate-limit umum hanya memuat user info | Seluruh Marketing API, prosedur audit rinci, penjadwalan, webhook TikTok |
| X | Harga snapshot, PKCE wajib, kode 30 dtk, Ads API OAuth 1.0a, rate limit | Harga "summoned" US$0,010; kutipan post hanya Enterprise; tidak ada tier Free/Basic/Pro di halaman | Badan penukaran kode, skema header klien rahasia, panjang teks maks, harga unggah media, ketidakkonsistenan 100 vs 200/15 menit |
| DOKU | KYB, retry, Notification URL, host, 60 dtk, settlement, refund, chargeback | Biaya refund dan batas e-wallet; setoran dana refund non-kartu; `order.currency` default IDR di Checkout; status `REFUNDED` (OVO) | Aturan kode pos/alamat, daftar dokumen per badan usaha, channel aktif, daftar IP DOKU, checklist go-live resmi, URL login Back Office |

## 7. Blocker yang butuh Founder (cukup dari Chrome Android)

Menu di portal penyedia bisa berubah; tautan di bawah adalah halaman masuk, bukan jaminan lokasi menu. Tidak ada langkah yang butuh laptop atau CLI. Jangan menulis kata sandi, Secret Key, atau token ke chat, issue, atau PR (repo ini publik).

| # | Platform | Tindakan Founder | Tautan | Hasil yang membuka blokir |
|---|---|---|---|---|
| 1 | Meta | Mulai Business Verification untuk PT Tanyopo Future Technology (dokumen legalitas sebagai foto/PDF dari HP) | https://business.facebook.com/settings/security | Syarat Advanced Access |
| 2 | Meta | Setelah 1 selesai: ajukan Advanced Access `ads_management` dan `ads_read` (dan izin Page bila terbukti perlu) dengan screencast layar HP | https://developers.facebook.com/apps/ (pilih app LINOE, App Review, Permissions and Features) | Tenant dapat menghubungkan akun iklan mereka |
| 3 | Meta | Siapkan akun iklan uji dan Halaman uji; beri persetujuan eksplisit sebelum gerbang S1 dibuka untuk uji | https://business.facebook.com/ | Uji satuan budget IDR dan objek `PAUSED` |
| 4 | TikTok | Putuskan prioritas: posting konten (Open API v2) atau iklan (Marketing API). Rekomendasi dokumen TikTok: Open API v2 dulu | (keputusan) | Menentukan app mana yang dibuat |
| 5 | TikTok | Buat app Login Kit + Content Posting API (ikon 1024x1024, URL privasi/ketentuan, redirect https), verifikasi URL, rekam demo (maks 5 video, masing-masing maks 50 MB), kirim review | https://developers.tiktok.com/apps/ | Scope disetujui; tanpa audit hanya posting privat |
| 6 | TikTok | Ajukan audit Content Posting setelah review disetujui (agar bisa posting publik) | https://developers.tiktok.com/apps/ ; panduan https://developers.tiktok.com/doc/content-sharing-guidelines | Posting publik; prosedur audit rinci BELUM TERVERIFIKASI |
| 7 | TikTok | Daftar developer Marketing API (hanya bila iklan TikTok dipilih) | https://business-api.tiktok.com/portal | Kredensial `app_id`/`secret`; alurnya BELUM TERVERIFIKASI |
| 8 | X | Hanya bila X diaktifkan: buat developer account dan App (Web App/confidential), aktifkan OAuth 2.0 PKCE, daftarkan callback `https://<domain>/api/connections/x/callback`, beli kredit kecil dan set batas belanja bulanan | https://console.x.com | Kredensial X dan kredit; env di Netlify butuh frasa persetujuan |
| 9 | X | Putuskan apakah iklan X diperlukan. Bila tidak, cukup posting organik | (keputusan) | X Ads API tetap tidak didukung |
| 10 | DOKU | Pantau perbaikan kode pos merchant dan KYB; minta konfirmasi tertulis ke DOKU Care | https://dashboard.doku.com (Back Office; URL login tidak disebut dokumen DOKU, dugaan dari domain dokumentasi) | KYB disetujui, produksi bisa dibahas (bukan dinyalakan) |
| 11 | DOKU | Buat situs Netlify sandbox terisolasi, dua user uji di Supabase sandbox, isi Notification URL, jalankan skenario S0 sampai S15 lewat simulator | https://sandbox.doku.com/integration/simulator/ dan runbook bagian 3 sampai 5 | Bukti SANDBOX E2E per channel (bagian 7.4 runbook) |
| 12 | DOKU | Tanya DOKU Care: prosedur refund non-kartu (setoran dana vs tiket), channel aktif, daftar dokumen per badan usaha, apakah Check Status mengirim `order.currency` | tiket lewat Back Office | Menutup B-CUR dan celah refund |

Tidak berubah: `PAYMENT_LIVE_ENABLED` OFF; Gate S1 terkunci; semua perubahan env, scope OAuth, saklar `X_OAUTH_PKCE_WIRED`, migrasi, dan pendaftaran konektor menunggu frasa persetujuan eksplisit Founder.

## 8. Temuan yang butuh persetujuan Founder (di luar file milik dokumen ini)

1. **Scope Meta**: `lib/connectors/meta-connector.ts` (`SCOPES`) belum memuat `pages_read_engagement`, dependensi `ads_management` menurut dokumen izin Meta. Rancangan: uji di akun uji dulu; bila terbukti perlu, tambahkan scope itu dan perbarui tes pengunci scope. Menyentuh OAuth dan App Review.
2. **`docs/INTEGRATIONS.md`** masih menyebut "X Ads API v12" dan "tanpa PKCE" (usang menurut [X_INTEGRATION.md](X_INTEGRATION.md)) dan Meta v25.0 sudah benar di sana. File itu bukan milik dokumen ini; usulan: ganti kalimat X dengan rujukan ke X_INTEGRATION.md.
3. **`prompter_platform_capabilities.api_version`** masih `v21.0` untuk Meta (butuh migrasi, tidak disentuh).

## 9. Risiko

- Seluruh isi bagian dokumentasi dibaca lewat alat pembaca-ringkas, bukan salinan penuh; periksa kutipan penting di halaman asli sebelum keputusan finansial atau pengajuan.
- Harga X dan biaya refund DOKU bisa berubah tanpa pemberitahuan; angka adalah snapshot 2026-11-11.
- Halaman Meta yang menjadi dasar Business Verification wajib adalah halaman izin, bukan halaman proses verifikasi; daftar dokumen dan lamanya proses belum diketahui, jadi jadwal Advanced Access tidak dapat diperkirakan.
- Lulus tes mock tidak membuktikan platform menerima permintaan. Tidak ada klaim LIVE, REAL E2E, atau CUSTOMER READY.
