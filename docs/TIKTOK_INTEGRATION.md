# Integrasi TikTok — audit, perbaikan kode, dan yang menunggu TikTok

Tanggal audit: 2026-11-11. Dokumen resmi dibaca lewat `developers.tiktok.com` pada tanggal yang sama (daftar sumber di bagian akhir). Bagian yang tidak bisa dibaca dari dokumen resmi ditandai **BELUM TERVERIFIKASI** — tidak ditebak.

## 1. Status ringkas (label jujur)

| Area | Label |
|---|---|
| Konektor Ads (`tiktok-connector.ts`): retry/backoff, pemetaan error, validasi respons | **UNIT TEST PASS** (fetch palsu, tanpa jaringan) |
| Klien Open API v2 baru (`tiktok-content-posting.ts`): OAuth + scope, refresh, creator info, init Direct Post / Upload, chunk, status | **CODE READY + UNIT TEST PASS**. Belum terpasang ke UI/route/`get-connector.ts` |
| Login nyata, upload/publikasi nyata, insight Ads nyata | **EXTERNAL BLOCKED** (butuh TikTok, lihat bagian 8) |
| Mock/sandbox/real E2E | Belum ada: **bukan** MOCK E2E, SANDBOX E2E, atau REAL E2E PASS. Tidak ada klaim CUSTOMER READY |

Tidak ada panggilan jaringan ke TikTok dari tes. Gerbang S1 (`BUDGET_WRITE_ENABLED_PLATFORMS`) dan `PAYMENT_LIVE_ENABLED` tidak disentuh. UI `/connections` masih menampilkan TikTok sebagai "Segera hadir", jadi tidak ada jalur pengguna yang memanggil kode ini.

## 2. Dua produk TikTok yang berbeda (jangan dicampur)

| | Open API v2 (organik) | Marketing API (iklan) |
|---|---|---|
| Untuk | Login Kit, Content Posting API (Direct Post / Upload ke inbox) | Kampanye, ad group, iklan, laporan |
| Portal | developers.tiktok.com | business-api.tiktok.com (TikTok for Business) |
| Kredensial | `client_key` + `client_secret` | `app_id` + `secret` |
| Otorisasi | `https://www.tiktok.com/v2/auth/authorize/` dengan `scope`, `response_type=code` | `https://business-api.tiktok.com/portal/auth` (`app_id`, `redirect_uri`, `state`; tidak ada parameter `scope`) |
| Token | `POST open.tiktokapis.com/v2/oauth/token/`; akses 24 jam, refresh 365 hari, refresh token bisa berganti | `POST business-api.tiktok.com/open_api/v1.3/oauth2/access_token/`; umur token **BELUM TERVERIFIKASI** |
| Kode di repo | `lib/connectors/tiktok-content-posting.ts` (baru) | `lib/connectors/tiktok-connector.ts` (ada, diperkuat) |
| Dipakai app | Belum (tidak terdaftar) | Terdaftar di `get-connector.ts` sebagai `TIKTOK`, tetapi UI "Segera hadir" |

Token satu produk tidak boleh dikirim ke produk lain. Catatan: tabel `prompter_connected_accounts` unik per `(tenant_id, platform)` dan `platform` hanya `META | TIKTOK | X`, jadi satu tenant hanya bisa punya **satu** koneksi TikTok. Memakai Ads dan Konten bersamaan butuh migrasi (lihat bagian 7).

## 3. Temuan audit pada kondisi `main`

| # | Temuan | Tindakan |
|---|---|---|
| 1 | URL authorize Marketing API tidak mengirim `scope`. | Itu memang bentuk flow portal Marketing API (izin diatur di app). Didokumentasikan; tes mengunci bentuk URL. Untuk Open API v2 `scope` wajib: `buildTikTokAuthorizeUrl` selalu mengirimnya (koma), menolak daftar kosong/scope tak dikenal. |
| 2 | Tidak ada refresh token. | Klien Open API v2: `refresh()` (refresh token berotasi dan dikembalikan), `ensureFreshTokens()` (cek kedaluwarsa dengan margin 5 menit; refresh/token habis menjadi `REFRESH_REJECTED` = harus hubungkan ulang). Marketing API: **BELUM TERVERIFIKASI**, tidak ada refresh yang ditebak. |
| 3 | Error berupa `Error` biasa dengan teks TikTok. | `TikTokApiError` (turunan `ConnectorApiError`) dengan `kind`, `status`, `code`, `logId`, `retryable`, `requiresReconnect`. Pesan penyedia tidak pernah dilog. |
| 4 | Tidak ada retry/backoff. | `tiktok-http.ts`: HTTP 429 dicoba ulang (maks 3 kali, backoff 0,5/1/2 dtk, `Retry-After` dihormati, batas keras 5). 5xx/jaringan hanya diulang untuk panggilan baca atau berstatus-absolut (pause, set budget, polling status, refresh). Panggilan pembuatan (campaign, iklan, init post, tukar kode) **tidak** diulang karena hasilnya tidak diketahui (risiko duplikat). |
| 5 | Respons tidak divalidasi (`ad_ids[0]` bisa `undefined`, `list` bisa hilang). | Id yang hilang menjadi error jelas; laporan kosong menjadi nol; baris tak valid dilewati. |
| 6 | `refreshable: true` dan `expires_at` di callback tidak mencerminkan TikTok. | Perlu perubahan file bersama (bagian 7). |
| 7 | Tidak ada penanganan `open_id`/identitas Login Kit; callback memanggil `getAccounts()` dan menganggap hasilnya akun iklan. | Klien baru punya `getUserInfo()`; pemasangan butuh keputusan Founder (bagian 7). |
| 8 | PR lama #24 (`feat/tiktok-login-kit-connector`) mengganti konektor Ads dengan Login Kit saja. | Dipakai hanya sebagai referensi. Tidak digabung: keputusan produk belum ada, dan pendekatan "satu slot TIKTOK" bentrok dengan kebutuhan Ads. |

## 4. Content Posting API: apa yang bisa dan tidak bisa

Terverifikasi dari dokumen resmi (sumber di bagian 9):

- **Direct Post**: `POST /v2/post/publish/video/init/`, scope `video.publish`, 6 permintaan/menit per token pengguna. `privacy_level` wajib salah satu dari `privacy_level_options` hasil `creator_info/query`.
- **Upload (inbox)**: `POST /v2/post/publish/inbox/video/init/`, scope `video.upload`, 6/menit, maks 5 pending share per 24 jam. Kreator menyelesaikan dan menekan posting di aplikasi TikTok.
- **Creator info**: `POST /v2/post/publish/creator_info/query/`, 20/menit. Wajib dipanggil saat menampilkan layar posting (opsi privasi, duet/stitch/komentar, durasi maks).
- **Status**: `POST /v2/post/publish/status/fetch/`, 30/menit. Status `PROCESSING_UPLOAD`, `PROCESSING_DOWNLOAD`, `SEND_TO_USER_INBOX`, `PUBLISH_COMPLETE`, `FAILED` (+ `fail_reason`; `internal` dan `*_pull_failed` boleh dicoba ulang, `spam_risk*` dan `auth_removed` tidak).
- **Sumber video**: `FILE_UPLOAD` (chunk 5-64 MB, chunk terakhir sampai 128 MB, maks 1000 chunk, berurutan, `Content-Range`, 206 = lanjut, 201 = selesai, `upload_url` berlaku 1 jam) atau `PULL_FROM_URL` (domain/prefiks URL harus terverifikasi di portal, https, tanpa redirect). Maks video 4 GB, MP4/MOV/WebM.
- **Audit**: klien yang belum diaudit hanya boleh memposting `SELF_ONLY` (privat), akun harus privat, maks 5 pengguna per 24 jam. Hanya audit yang mencabut batasan itu. Syarat audit: tampilkan info kreator, privasi tanpa nilai bawaan, pengaturan interaksi, deklarasi persetujuan musik, pengungkapan konten berbayar, tanpa watermark/promosi tambahan, pratinjau, dan polling status atau webhook.

Yang sudah ada di kode: `planChunks`, `initDirectPost` (privasi dipaksa `SELF_ONLY` bila `clientAudited` false; bila true, privasi wajib dipilih eksplisit dan harus ada di opsi kreator), `initInboxUpload`, `uploadChunk`, `fetchPublishStatus`, `queryCreatorInfo`, validasi lokal (caption maks 2200, durasi, https). Default `clientAudited` tidak ada: pemanggil harus menyatakannya, dan setting itu baru boleh `true` setelah TikTok menyetujui audit.

**Penjadwalan**: halaman referensi yang dibaca tidak memuat parameter jadwal-tayang pada endpoint init (BELUM TERVERIFIKASI bahwa API tidak mendukungnya). Rancangan aman: LINOE menyimpan jadwal sendiri (antrean job yang sudah ada, `lib/jobs`) dan memanggil init saat waktunya, dengan persetujuan Founder/Owner dan batas harian TikTok (kira-kira 15 posting per akun per hari dari panduan audit; Upload 5 pending/24 jam).

**Webhook**: TikTok mengirim ke URL https yang didaftarkan di portal; endpoint harus langsung membalas HTTP 200; pengiriman ulang dengan backoff sampai 72 jam; sifatnya minimal-sekali, jadi pemrosesan harus idempoten. Daftar event dan algoritma verifikasi tanda tangan (`TikTok-Signature`) **BELUM TERVERIFIKASI** (halaman Events/Verification tidak terbaca). Belum ada route webhook: sampai itu terverifikasi, pakai polling status.

## 5. Batas laju dan penanganan error

Batas terverifikasi (per token pengguna): init 6/menit, status 30/menit, creator info 20/menit; `/v2/user/info/` 600/menit (jendela geser 1 menit). Melebihi batas = HTTP 429 `rate_limit_exceeded`. Marketing API: batas **BELUM TERVERIFIKASI**; 429 tetap ditangani, kode numerik tidak ditafsirkan.

| `kind` | Pemicu (kode TikTok) | `retryable` | `requiresReconnect` |
|---|---|---|---|
| `AUTH_EXPIRED` | `access_token_invalid`, HTTP 401 | tidak | ya (refresh dulu; gagal = `REFRESH_REJECTED`) |
| `REFRESH_REJECTED` | refresh ditolak / kedaluwarsa / tidak ada | tidak | ya |
| `SCOPE_MISSING` | `scope_not_authorized`, `scope_permission_missed` | tidak | ya |
| `RATE_LIMITED` | `rate_limit_exceeded`, HTTP 429 | ya | tidak |
| `DAILY_CAP` | `spam_risk_too_many_posts`, `spam_risk_too_many_pending_share`, `reached_active_user_cap` | tidak (tunggu besok) | tidak |
| `UNAUDITED_CLIENT` | `unaudited_client_can_only_post_to_private_accounts` | tidak | tidak (butuh audit) |
| `USER_BANNED` | `spam_risk_user_banned_from_posting` | tidak | tidak |
| `URL_UNVERIFIED` | `url_ownership_unverified` | tidak | tidak |
| `PRIVACY_MISMATCH` | `privacy_level_option_mismatch` | tidak | tidak |
| `INVALID_REQUEST` | `invalid_param(s)`, `invalid_file_upload`, `invalid_request`, HTTP 400 | tidak | tidak |
| `SERVER_ERROR` / `NETWORK` | `internal_error`, 5xx, timeout | ya | tidak |

Rekomendasi status koneksi untuk pemanggil nanti (`StoredConnectionStatus`): `requiresReconnect` -> `ACTION_REQUIRED` (atau `EXPIRED` bila refresh token lewat batas 365 hari); kind lain tidak mengubah status.

## 6. Isolasi tenant dan penyimpanan token

- Callback (bersama, tidak diubah): `state:tenantId` di cookie httpOnly sekali pakai, token dienkripsi AES-256-GCM, ditulis hanya lewat klien service-role ke `prompter_oauth_credentials` (RLS tanpa policy). Itu tetap berlaku untuk TikTok.
- Klien baru tidak memegang state, tidak membaca env, dan tidak tahu tenant: semua kredensial dan token dimasukkan pemanggil. Pemanggil wajib memuat token dengan filter `tenant_id` **dan** id koneksi (pola yang sama dengan pemeriksaan kesiapan Meta), lalu menyimpan hasil refresh terenkripsi dengan filter yang sama.
- Risiko tercatat: tidak ada unique pada `external_account_id`, jadi satu akun TikTok (`open_id`) bisa terhubung ke dua tenant. Webhook yang memetakan `open_id` -> tenant harus menolak/men-flag pemetaan ganda.
- Pesan error penyedia tidak dilog (`safe-error-log.ts`): `type` = `kind` selalu aman; `code` TikTok yang lebih dari 16 karakter otomatis dibuang oleh pola allowlist di sana.

## 7. Kebutuhan file bersama (dilaporkan, TIDAK diubah di PR ini)

Butuh persetujuan Founder karena menyentuh file bersama / skema:

1. `lib/connectors/oauth-callback.ts`: (a) `refreshable: true` dan `last_refreshed_at` selalu diisi walau konektor tidak punya refresh; (b) `refresh_expires_at` tidak disimpan (kolom belum ada); (c) tidak ada job penyegar token; (d) `scopes` yang diberikan perlu dibandingkan dengan yang diminta (`missingScopes`) sebelum status `CONNECTED`; (e) tidak membaca `scopes`/`error_description` pada redirect TikTok.
2. `lib/connectors/get-connector.ts`: pendaftaran konektor Open API v2 (Login Kit/Konten) dan keputusan Ads vs Konten untuk slot `TIKTOK`.
3. Migrasi SQL (`supabase/migrations`, tidak disentuh): memisah platform menjadi mis. `TIKTOK_ADS` dan `TIKTOK_CONTENT`, atau kolom `refresh_expires_at`; unik pada `(platform, external_account_id)` bila ingin mencegah akun ganda.
4. `lib/connectors/safe-error-log.ts`: `CODE_PATTERN` 16 karakter membuang kode TikTok yang panjang; kalau ingin `code` ikut terlog, perlu dilonggarkan.
5. `lib/connectors/oauth-authorize.ts`: untuk Open API v2 tidak butuh PKCE (web), jadi tidak ada perubahan wajib. Bila nanti pakai app mobile/desktop, `code_verifier` wajib.
6. Env (Netlify, tidak disentuh): Open API v2 memakai nama berbeda dari kredensial Ads (`client_key`/`client_secret`); bila slot `TIKTOK_APP_ID`/`TIKTOK_APP_SECRET` dipakai ulang, isinya harus kredensial produk yang aktif, jangan dicampur.

## 8. EXTERNAL BLOCKED dan tindakan Founder minimal

Yang hanya bisa dilakukan TikTok / pemilik akun (semuanya lewat browser HP):

| Izin / langkah | Status | Siapa |
|---|---|---|
| App di developers.tiktok.com dengan produk Login Kit dan Content Posting API (organisasi, ikon 1024x1024, kategori, deskripsi, URL privasi/ketentuan, redirect URI https) | EXTERNAL BLOCKED | Founder |
| Verifikasi URL: file prefiks sudah ada di `public/` (diizinkan di `proxy.ts`); domain/prefiks untuk `PULL_FROM_URL` bila dipakai | Sebagian siap | Founder |
| App review: demo video alur lengkap (maks 5 video, masing-masing maks 50 MB; rekam layar HP cukup), penjelasan tiap scope | EXTERNAL BLOCKED | Founder submit, TikTok menilai |
| Scope `user.info.basic`, `video.upload`, `video.publish` disetujui (dinilai dalam app review) | EXTERNAL BLOCKED | TikTok |
| Mengaktifkan konfigurasi Direct Post | EXTERNAL BLOCKED | Founder + TikTok |
| Audit Content Posting (agar bisa posting publik; tanpa ini hanya `SELF_ONLY`) | EXTERNAL BLOCKED | TikTok |
| Sandbox: pengguna uji ditambahkan di portal, bisa dipakai tanpa review tetapi terbatas | Belum dicoba | Founder |
| Marketing API: app TikTok for Business, akses advertiser, kredensial `app_id`/`secret` | EXTERNAL BLOCKED | Founder + TikTok |
| Mengisi env produksi dan mendaftarkan konektor | Menunggu frasa persetujuan eksplisit | Founder |

Langkah minimum paling berguna sekarang: putuskan apakah prioritas pertama adalah **posting konten (Open API v2)** atau **iklan (Marketing API)**. Rekomendasi: Open API v2 dulu, karena file verifikasi domain developers.tiktok.com sudah ada di repo dan tidak ada biaya iklan yang terlibat. Lalu buat app di portal dan submit review (dua tugas itu yang menentukan jadwal; TikTok tidak memberi tenggat waktu yang terbaca di dokumen). Sampai persetujuan keluar, kode tetap tidak aktif.

## 9. Sumber (diakses 2026-11-11)

Semua di `https://developers.tiktok.com/doc/`: `login-kit-web`, `oauth-user-access-token-management`, `content-posting-api-get-started`, `content-posting-api-reference-direct-post`, `content-posting-api-reference-upload-video`, `content-posting-api-reference-query-creator-info`, `content-posting-api-reference-get-video-status`, `content-posting-api-media-transfer-guide`, `content-sharing-guidelines`, `tiktok-api-v2-error-handling`, `tiktok-api-v2-rate-limit`, `getting-started-create-an-app`, `webhooks-overview`.

Tidak terjangkau (BLOCKED, tidak ada di allowlist sesi): `business-api.tiktok.com/portal/docs` (Marketing API: auth, umur token, kode error, batas laju). Semua klaim Marketing API di dokumen ini berasal dari kode yang sudah ada, bukan dari dokumen resmi, dan ditandai tidak terverifikasi.
