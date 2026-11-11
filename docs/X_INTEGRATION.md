# Integrasi X (Twitter) — audit, status, biaya, blocker

Terakhir diaudit: **2026-11-11**. Semua klaim dari dokumentasi resmi mencantumkan URL sumber; yang tidak terbaca ditandai **BELUM TERVERIFIKASI**.

## 1. Status (jujur)

| Area | Status | Catatan |
|---|---|---|
| Klien X API v2 (token, refresh, revoke, `users/me`, posting teks/gambar/video, metrik organik) | **CODE READY + UNIT TEST PASS** | Diuji dengan `fetch` palsu. Belum pernah menyentuh X sungguhan. |
| Alur OAuth lewat jalur bersama (`oauth-authorize.ts` / `oauth-callback.ts`) | **CODE READY + UNIT TEST PASS, saklar MATI (fail-closed)** | Jalur bersama kini mendukung PKCE (cookie `x_oauth_verifier` httpOnly terikat state + tenant + user, Path hanya route callback, dihapus saat callback). `X_OAUTH_PKCE_WIRED` tetap `false`: `isConfigured()` false, authorize/callback X menolak `not_configured`. Mengubah saklar = persetujuan Founder (bagian 7A). |
| Operasi iklan X (kampanye, ad set, creative, ad, statistik iklan, jeda, anggaran) | **TIDAK DIDUKUNG (fail-closed)** | X Ads API hanya OAuth 1.0a + butuh persetujuan akses Ads (bagian 2). |
| Posting organik dari UI/aksi aplikasi | **BELUM TERSAMBUNG** | `publishPost`/`uploadMedia` ada di `XConnector`, tetapi tidak dipanggil dari mana pun; capability `PUBLISH_CONTENT` tetap nonaktif. |
| Penjadwalan | **TIDAK ADA di sisi X** | Lihat bagian 4. |
| MOCK E2E / SANDBOX E2E / REAL E2E / CUSTOMER READY | **BELUM** | Jangan diklaim. Penyedia belum memberi izin = **EXTERNAL BLOCKED**. |

## 2. Temuan audit kode lama (`lib/connectors/x-connector.ts`)

1. **Host & autentikasi iklan tidak sesuai dokumen.** Kode lama memakai `https://ads-api.twitter.com/12` dengan `Authorization: Bearer <token OAuth 2.0>`. Dokumen resmi: host Ads API `https://ads-api.x.com`, versi di path pertama (contoh `/6/accounts`), **hanya OAuth 1.0a**, dan aplikasi harus **disetujui untuk akses Ads** ([making-authenticated-requests](https://docs.x.com/x-ads-api/fundamentals/making-authenticated-requests.md), diakses 2026-11-11). Versi `12` dan Bearer OAuth 2.0 tidak terbukti. Semua operasi iklan sekarang melempar `ConnectorConfigError` tanpa mengirim permintaan.
2. **Tanpa PKCE.** Dokumen mencantumkan `code_challenge` + `code_challenge_method` (`S256`/`plain`) pada URL otorisasi ([authorization-code](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code.md), 2026-11-11). Kode lama tidak mengirimnya.
3. **Host usang.** `twitter.com/i/oauth2/authorize` dan `api.twitter.com/2/oauth2/*` diganti `x.com/i/oauth2/authorize` dan `api.x.com/2/oauth2/{token,revoke}` sesuai dokumen. (Apakah host lama masih meneruskan: BELUM TERVERIFIKASI; tidak dipakai lagi.)
4. **Scope salah.** `ads.read ads.write` bukan scope yang tercantum di tabel scope OAuth 2.0. Scope publikasi sekarang: `tweet.read tweet.write users.read media.write offline.access` (semua ada di tabel scope dokumen).
5. Statistik iklan memakai `reach: 0` dan field tebakan — dihapus bersama jalur Ads.

## 3. Spesifikasi yang dipakai (sumber resmi, diakses 2026-11-11)

- **Otorisasi**: `GET https://x.com/i/oauth2/authorize` dengan `response_type=code`, `client_id`, `redirect_uri` (harus persis sama dengan callback di pengaturan App), `scope` (dipisah spasi), `state` (maks 500 karakter), `code_challenge`, `code_challenge_method`.
  Sumber: <https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code.md>
- **Token**: `POST https://api.x.com/2/oauth2/token`. Kode otorisasi **kedaluwarsa 30 detik** setelah diterima. Klien rahasia (confidential) mengirim header `Authorization` (skema tidak disebut eksplisit di halaman; kode memakai `Basic client_id:secret` — **skema eksplisit BELUM TERVERIFIKASI**). Nama parameter badan penukaran kode (`code`, `code_verifier`, `redirect_uri`, `grant_type`) **tidak tercantum di halaman itu**; dipakai sesuai standar OAuth 2.0/RFC 7636 — verifikasi pada uji sandbox.
- **Masa berlaku**: access token 2 jam default; refresh token hanya diberikan bila scope `offline.access` diminta. Refresh: `POST /2/oauth2/token` dengan `grant_type=refresh_token`, `refresh_token`. Revoke: `POST https://api.x.com/2/oauth2/revoke`. Sumber: halaman yang sama + <https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token.md>.
- **Scope relevan** (tabel dokumen): `tweet.read`, `tweet.write`, `users.read`, `media.write`, `offline.access`. Contoh URL di dokumen memakai `account.follows.*` sementara tabel memakai `follows.*` (tidak relevan di sini).
- **Posting**: `POST https://api.x.com/2/tweets`, OAuth 2.0 user token dengan `tweet.read users.read tweet.write`. Badan JSON: `text` (wajib kecuali ada media), `media.media_ids` (1-4). Maks 4 foto ATAU 1 GIF ATAU 1 video per post. Respons sukses `201` dengan `data.id`. Batas panjang teks dan aturan duplikat **tidak tercantum** di halaman itu (jangan diasumsikan 280). Sumber: <https://docs.x.com/x-api/posts/create-post.md>.
- **Media v2**: `POST /2/media/upload/initialize` (JSON: `media_type`, `total_bytes`, `media_category`), `POST /2/media/upload/{id}/append` (multipart `segment_index`, `media`; segmen <= 5 MB, maksimum server 8 MB), `POST /2/media/upload/{id}/finalize`, `GET /2/media/upload?command=STATUS&media_id=` sampai `succeeded`/`failed`, hormati `check_after_secs`. Scope `media.write`. Batas: gambar 5 MB, GIF 15 MB, video 20 menit/8 GB (Premium 125 menit/16 GB). Protokol lama `command=INIT|APPEND|FINALIZE` pada `/2/media/upload` tidak dipakai. Sumber: <https://docs.x.com/x-api/media/quickstart/media-upload-chunked.md>, <https://docs.x.com/x-api/media/initialize-media-upload.md>.
- **Identitas**: `GET https://api.x.com/2/users/me`, scope `users.read tweet.read`. Sumber: <https://docs.x.com/x-api/users/get-my-user.md>.
- **Analitik yang benar-benar tersedia**: `GET /2/tweets/{id}?tweet.fields=...`. `public_metrics` (like, reply, retweet, quote, bookmark, impression) dengan Bearer apa pun; `organic_metrics`/`non_public_metrics` (impresi, klik tautan, klik profil, engagement, kuartil video) butuh konteks pengguna, hanya untuk post milik pengguna, **hanya post <= 30 hari**. `promoted_metrics` hanya untuk post berpromosi. Ini metrik post organik, **bukan** statistik kampanye iklan. Sumber: <https://docs.x.com/x-api/fundamentals/metrics.md>, <https://docs.x.com/x-api/posts/lookup/integrate.md>.

## 4. Penjadwalan, retry, rate limit

- **Penjadwalan**: badan `POST /2/tweets` pada dokumen tidak punya field jadwal. Penjadwalan harus dilakukan aplikasi sendiri (pekerja terjadwal memanggil `publishPost` saat jatuh tempo). Itu butuh tabel antrean/idempotency (migrasi SQL) — **butuh persetujuan Founder**, tidak dikerjakan di PR ini.
- **Retry** (`x-api-client.ts`): `POST /2/tweets`, penukaran kode, refresh, initialize, finalize **tidak pernah diulang otomatis** (risiko post ganda / kode sekali pakai). Hanya APPEND (idempoten per `segment_index`), STATUS dan GET yang diulang maks 2x pada 429/5xx, menunggu `x-rate-limit-reset` (maks 60 dtk) atau backoff. 429 pada posting dilempar sebagai `XRateLimitError` berisi `limit/remaining/resetAt` agar penjadwal dapat menunda.
- **Rate limit** ([rate-limits](https://docs.x.com/x-api/fundamentals/rate-limits)): `POST /2/tweets` 10.000/24 jam per App dan 100/15 menit per pengguna; `GET /2/users/me` 75/15 menit per pengguna; media initialize/append/finalize 1.875/15 menit per pengguna. Halaman [manage-tweets/integrate](https://docs.x.com/x-api/posts/manage-tweets/integrate) menyebut 200/15 menit per pengguna dan 300 per 3 jam — **dua halaman resmi tidak konsisten**; pakai yang paling ketat (100/15 menit) sampai dikonfirmasi di Developer Console. Header: `x-rate-limit-limit/remaining/reset`; 429 berkode 88.

## 5. Biaya API (model harga saat ini)

Sumber: <https://docs.x.com/x-api/getting-started/pricing.md>, diakses **2026-11-11**. Halaman menyebut "Prices are subject to change; current rates are in the Developer Console" — **angka di bawah adalah snapshot, wajib dicek ulang di Developer Console sebelum dipakai untuk keputusan**.

- Model: **bayar-per-pakai**, tanpa langganan/kontrak/minimum; kredit dibeli di muka dan dipotong per permintaan. Ada batas belanja per siklus tagihan (permintaan diblokir bila tercapai) dan auto-recharge opsional. Saldo negatif memblokir API.
- Harga: buat post **US$0,015**/permintaan; buat post **berisi URL US$0,200**/permintaan; baca post US$0,005; baca data milik sendiri US$0,001; baca user US$0,010; media metadata US$0,005. Harga unggah media (initialize/append/finalize) **tidak tercantum** di halaman — BELUM TERVERIFIKASI.
- Dedup 24 jam UTC untuk resource yang dibaca; batas 3 juta pembacaan post/siklus.
- Implikasi: post berisi tautan 13x lebih mahal dari post teks. Contoh 1.000 post/bulan: teks saja ~US$15; semuanya berisi URL ~US$200. Konstanta `X_PRICING_SNAPSHOT_USD` + `estimateXPostCostUsd` di `x-api-client.ts` hanya perkiraan internal.
- **PR ini tidak menimbulkan biaya**: tidak ada panggilan jaringan, tidak ada kredensial.

## 6. Isolasi tenant

Klien tidak punya state/cache global; token diberikan per panggilan (diuji: dua panggilan paralel dengan token berbeda tidak tercampur). Penyimpanan token tetap lewat jalur bersama (terenkripsi, `service_role`, RLS `prompter_oauth_credentials`) yang tidak diubah. `getAccounts` mengembalikan akun X pemilik token (`@username`), jadi satu koneksi X = satu tenant = satu akun X.

## 7. Blocker eksternal & rancangan yang butuh persetujuan

**A. PKCE di jalur OAuth bersama — TERIMPLEMENTASI, SAKLAR BUTUH PERSETUJUAN FOUNDER.**
Yang sudah ada (Draft PR terpisah): antarmuka tambahan `PkceConnector` (`lib/connectors/pkce-connector.ts`, `PlatformConnector` tidak diubah); `handleConnectorOauthAuthorize` membuat pasangan PKCE hanya untuk konektor `usesPkce`, mengirim hanya `code_challenge` S256 ke X, dan menyimpan verifier di cookie httpOnly `x_oauth_verifier` (nilai `state:tenantId:userId:verifier`, umur dan atribut sama dengan cookie state, tetapi `Path=/api/connections/x/callback`); `handleConnectorOauthCallback` membaca dan MENGHAPUS cookie itu sebelum penolakan apa pun (replay ditolak), memeriksa keterikatan state + tenant + user (perbandingan waktu-konstan) + format RFC 7636, lalu memanggil `exchangeCodeForTokenWithPkce`. Verifier, state, kode, dan token tidak pernah masuk URL, redirect, atau log (hanya alasan allowlist). Tidak menyentuh enkripsi, skema, migrasi, RLS, `proxy.ts`.
Untuk menyalakan: ubah `X_OAUTH_PKCE_WIRED` ke `true` di `x-connector.ts` (bukan env, tidak otomatis) hanya setelah frasa persetujuan Founder, kredensial X terisi (7D), dan uji sandbox.

**B. Akses X Ads API — EXTERNAL BLOCKED.** Butuh persetujuan aplikasi untuk Ads API + alur OAuth 1.0a (access token **dan token secret**). Skema DB saat ini hanya menyimpan access/refresh token terenkripsi, jadi butuh migrasi (terlarang tanpa persetujuan). Sampai itu ada, iklan X tetap tidak didukung.

**C. Penjadwalan posting** butuh migrasi antrean (lihat bagian 4).

**D. Konfigurasi X Developer Console (Founder, dari HP lewat browser):** buat developer account + App tipe *Web App/confidential*; aktifkan OAuth 2.0 (Authorization Code with PKCE) di pengaturan autentikasi App; daftarkan callback `https://<domain>/api/connections/x/callback`; isi `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI` di Netlify (perubahan env = butuh frasa persetujuan Founder); beli kredit dan set batas belanja bulanan kecil.

## 8. Tindakan Founder yang benar-benar wajib

Hanya bila X ingin diaktifkan: (1) setujui desain 7A dengan frasa persetujuan; (2) lakukan 7D; (3) putuskan apakah iklan X (7B) memang diperlukan — jika tidak, cukup posting organik. Selain itu tidak ada tindakan; PR ini aman digabung karena menutup (fail-closed) jalur yang tadinya tidak bisa bekerja.

## 9. Berkas

`lib/connectors/x-connector.ts`, `lib/connectors/x-api-client.ts`, `lib/connectors/x-pkce.ts`, `tests/unit/connectors/x-{connector,api-client,pkce}.test.ts`. `docs/INTEGRATIONS.md` masih menyebut "X Ads API v12" dan "tanpa PKCE" — pembaruannya ditunda agar tidak berbenturan dengan PR agen lain.
