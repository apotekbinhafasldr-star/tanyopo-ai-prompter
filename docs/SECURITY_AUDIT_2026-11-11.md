# Audit QA/Keamanan tingkat kode, soft launch 10 tenant (2026-11-11)

Status dokumen: DRAFT, hanya baca kode dan tes. Basis: `main` 6287160 (2026-11-11). Repo PUBLIK, log Actions publik.

Label bukti (TADS): **CODE** = dibaca di kode, **UNIT** = tes unit (CI), **INTEGRATION** = tes pada Postgres sekali pakai di CI, **MOCK**, **SANDBOX**, **REAL** = diverifikasi di sistem nyata, **UNKNOWN** = tidak bisa diverifikasi dari repo.
Tidak ada panggilan ke Supabase, Netlify, penyedia pembayaran atau platform iklan. Tidak ada perubahan pada kode produk. Semua nilai rahasia sengaja tidak ditulis di sini.

## 0. Ringkasan (baca ini dulu)

- **Tidak ada temuan P0** (tidak ditemukan kebocoran rahasia, jalur tanpa autentikasi ke data tenant, atau open redirect yang bisa dieksploitasi). Bukti: CODE + UNIT.
- **P1 (2)**, keduanya perubahan di `features/auth/*` sehingga **butuh persetujuan Founder**: SEC-01 (IP untuk pembatas daftar/OTP bisa dipalsukan lewat `x-forwarded-for`) dan SEC-02 (login tanpa pembatas aplikasi).
- **P2 (5)**, **P3 (4)**: bagian 3.
- Yang belum bisa diverifikasi dari repo (UNKNOWN): header keamanan benar-benar keluar di Netlify, status advisor RLS di proyek Supabase bersama, kerentanan dependensi (`npm audit` tidak terjangkau), nilai env produksi.
- PR ini menambah 6 berkas tes (`tests/unit/security/`) dan dokumen ini. Celah yang terverifikasi dikunci sebagai "keadaan saat ini" supaya CI memberi tanda tepat saat celah ditutup.

## 1. Pemindaian rahasia

Cakupan: seluruh pohon kerja `main` (1008 berkas teks, kecuali `package-lock.json`) dan riwayat git (541 commit, semua ref yang ter-fetch; 231 cabang). Pola: kunci API gaya OpenAI/AWS/Google/GitHub/Slack/Meta, JWT, blok kunci privat, kunci rahasia Supabase panjang, URL berisi kredensial, project ref Supabase. Metode: `git grep` dan pickaxe `git log -G` dengan regex, lalu setiap hit diklasifikasikan tanpa mencetak nilainya.

| Lokasi | Jenis | Penilaian | Bukti |
|---|---|---|---|
| `.github/workflows/ci.yml` baris 16 | placeholder berbentuk kunci publishable Supabase (`NEXT_PUBLIC_*`, nilai berakhiran "placeholder") | AMAN: placeholder untuk build, tidak ada panggilan jaringan | CODE |
| `tests/unit/netlify/notifier-core.test.ts` baris 5; `tests/unit/lib/doku-payment-provider.test.ts` baris 119 | string berbentuk kunci rahasia Supabase pendek (13 dan 16 karakter badan) | AMAN: fixture uji, jauh di bawah panjang kunci asli | CODE |
| `tests/unit/features/launch-claim-safety.test.ts`, `tests/unit/lib/meta-launch-preflight.test.ts` | URL berisi kredensial palsu | AMAN: fixture uji negatif (menguji penolakan) | CODE |
| 6 berkas tes (`pg-env-guard`, `doku-payment-provider`, `checkout-doku`, `payment-webhook-doku`, dst.) dan 3 migrasi, `supabase/sandbox/doku/*`, `supabase/prod-packages/manifest.json` | **project ref Supabase produksi bersama** (pengenal, bukan kredensial), dipakai sebagai daftar tolak (guard) | INFO (SEC-10): bukan rahasia, tetapi pada repo publik memudahkan pihak luar menyasar API proyek bersama. Satu-satunya kontrol adalah RLS | CODE |
| Riwayat git | tidak ada JWT, blok kunci privat, AKIA, `ghp_`, `sk-`, `AIza`, `xox`, kunci rahasia Supabase panjang yang pernah ditambahkan | BERSIH untuk ref yang ter-fetch. Ref di luar itu (mis. cabang PR yang sudah dihapus di GitHub) tidak terjangkau: UNKNOWN | CODE |
| `.env*` | hanya `.env.example` yang ter-commit; nilai semua kunci rahasia kosong; `PAYMENT_LIVE_ENABLED` dan `PAYMENT_SWEEPER_ENABLED` kosong; `.gitignore` memuat `.env*` | AMAN | CODE + UNIT (dikunci tes baru) |

Tindakan Founder untuk bagian ini: tidak ada yang wajib. Opsional: aktifkan "Secret scanning" dan "Push protection" di pengaturan repo GitHub (bisa dari HP, Settings > Code security).

## 2. Penelusuran akses data, route, header, redirect

### 2.1 Route API dan route handler (22 berkas `route.ts`)

Semua diklasifikasikan di `tests/unit/security/security-route-registry.test.ts`; route baru yang belum didaftarkan membuat CI gagal.

| Kelompok | Autentikasi | Catatan | Bukti |
|---|---|---|---|
| `/admin/**` (3 route) | `requireAdminPermission` + flag `ADMIN_CENTER_ENABLED` + cek `Origin` sama-asal, balasan 404 telanjang | baik | CODE + UNIT |
| `/ops/payments/export` | `getPaymentOperator()` sebelum pembacaan DB, GET baca-saja, batas laju | baik | CODE + UNIT |
| `/api/connections/*` (6) | sesi + peran owner; callback memeriksa `state` terikat tenant, PKCE untuk X; TikTok fail-closed `canStartOauth` | baik | CODE + UNIT |
| `/api/internal/jobs/process`, `/api/internal/payments/sweep` | token Bearer (`timingSafeEqual`), 503 bila rahasia kosong; verifikasi token sebelum `createAdminClient` | baik (lihat SEC-05) | CODE + UNIT |
| `/api/v1/integrations/umkmpro/*` (4) | HMAC-SHA256 atas `timestamp.body`, jendela 5 menit, banding waktu-konstan | lihat SEC-04 | CODE + UNIT |
| `/api/webhooks/payment` | batas ukuran 64 KB, verifikasi tanda tangan penyedia sebelum parse dan tulis; penyedia belum terkonfigurasi = 503 (fail-closed) | baik | CODE + UNIT |
| `/api/demo/start` | cookie bertanda tangan tanpa tenant; batas per IP dari `x-nf-client-connection-ip` saja, bukan `x-forwarded-for` | baik | CODE + UNIT |
| `/api/health`, `/api/ready` | publik, balasan tetap tanpa data | baik | CODE + UNIT |
| `/auth/callback`, `/auth/confirm` | kode/token Supabase; `next` disaring `safeNextPath`; `/auth/confirm` hanya menerima `type=signup` | baik | CODE + UNIT |

### 2.2 Server action (22 berkas, 70 fungsi diekspor)

- Semua fungsi memanggil `requireSessionContext()`/setara sebelum bekerja, kecuali tiga aksi pra-login (`loginAction`, `logoutAction`, `forgotPasswordAction`). Dikunci oleh `security-tenant-binding.test.ts`. Catatan: pemeriksaan bersifat statis dan perkiraan (penanda sesi muncul di teks fungsi), bukan pembuktian aliran data penuh.
- **Tidak ada** pembacaan `tenant_id` dari form, query string atau body di `features/`, `app/`, `lib/`, `services/` (435 berkas diperiksa). Satu-satunya penerima tenant dari pemanggil adalah skema `schemas/umkmpro.ts` di rute HMAC (SEC-04). Bukti: CODE + UNIT.
- Penggunaan klien service-role (`createAdminClient`) di aksi: 11 kueri ke `prompter_oauth_credentials` semuanya kini memfilter `tenant_id`. Temuan T8 pada `docs/SOFT_LAUNCH_10_TENANTS.md` (P1-8) sudah **tertutup di `main`** (dokumen itu belum diperbarui). Dikunci tes baru. Bukti: CODE + UNIT.

### 2.3 Header keamanan

`next.config.ts` memberi `nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy`, HSTS satu tahun (tanpa `includeSubDomains`/`preload`), dan CSP **Report-Only** (dilindungi tes lama). `netlify.toml` tidak punya blok `[[headers]]`.
- UNKNOWN: apakah header ini benar-benar keluar dari Netlify (bergantung `@netlify/plugin-nextjs`). Verifikasi dari HP: buka situs produksi di browser, atau pindai di situs pemeriksa header publik, lalu cek `X-Frame-Options` dan `Content-Security-Policy-Report-Only`.
- CSP memuat `'unsafe-inline'` dan `'unsafe-eval'` di `script-src` dan tanpa `report-uri` (SEC-07).

### 2.4 Open redirect

`/auth/callback` dan `/auth/confirm` aman. Dua lapis: bentuk string, lalu parse WHATWG terhadap origin probe. 18 vektor tambahan diuji lewat handler asli (dot-segment `/.//x`, `/a/..//x`, pemisah baris Unicode, slash ter-encode, `javascript:`, `next` bersarang) dan semuanya tetap di origin aplikasi. `/auth/confirm` menolak `recovery`, `magiclink`, `invite`, `email_change`, `email`, `sms`, kosong dan `SIGNUP` tanpa memanggil `verifyOtp`. Aksi `loginAction` memakai `safeNextPath` yang sama. Bukti: CODE + UNIT. `redirect(result.checkoutUrl)` pada `startCheckoutAction` berasal dari penyedia dan dijaga `checkout-origin` (tes lama).

### 2.5 Kebocoran info pada respons galat

Lihat SEC-03 dan SEC-05. Server action mengembalikan pesan tetap berbahasa Indonesia, bukan teks galat mentah (diverifikasi lewat pemindaian statis; satu-satunya jalur `err.message` ke klien ada di 4 route UMKMpro).

## 3. Temuan

Peringkat: P0 = hentikan peluncuran; P1 = sebelum tenant ke-11 atau 2 minggu pertama; P2 = jadwalkan; P3 = kebersihan. "Perbaikan" tidak dikerjakan di PR ini (file bukan milik tugas atau terlarang).

| ID | Pri | Temuan | Bukti | Perbaikan (rancangan) | Pemilik |
|---|---|---|---|---|---|
| SEC-01 | P1 | `registerAction`, `verifyEmailOtpAction`, `resendSignupOtpAction` memakai `getClientIp` (`lib/rate-limit.ts` baris 67-78) yang jatuh ke hop pertama `x-forwarded-for` bila header Netlify tak ada. Klien bisa memutar nilainya sehingga pembatas per-IP (anti trial-farming dan tebak kode OTP) tidak mengikat. Pembatas per-email OTP tetap bekerja. Apakah klien bisa memalsukan `x-nf-client-connection-ip`: UNKNOWN | CODE + UNIT (tes bukti memutar XFF menghasilkan kunci berbeda) | Pakai `getTrustedClientIp` + `ipBucketKey` (`lib/security/client-ip.ts`) di `features/auth/actions.ts` baris 129 dan `features/auth/otp-actions.ts` baris 53, 88, dengan satu bucket ketat bersama bila IP `null`, persis pola `app/api/demo/start/route.ts` | **Butuh persetujuan Founder** (auth) |
| SEC-02 | P1 | `loginAction` tanpa pembatas aplikasi; `lib/security/login-throttle.ts` sudah ada, teruji, tetapi tidak terpasang. Hanya batas Supabase Auth per-IP (sama dengan T1 di dokumen soft launch) | CODE + UNIT | Panggil `checkLoginThrottle(ip, email)` setelah validasi skema dan sebelum `signInWithPassword` (`features/auth/actions.ts` baris 77), balas `LOGIN_THROTTLED_MESSAGE`; gabungkan dengan SEC-01 agar IP tepercaya | **Butuh persetujuan Founder** (auth) |
| SEC-03 | P2 | Empat route UMKMpro mengembalikan `err.message` mentah pada 500 (`conversions` baris 49-50, `products` 48-49, `promotions` 59-60, `webhooks` 49-50). Pesan driver DB bisa memuat nama tabel/constraint. Pemanggil sudah terautentikasi HMAC, jadi sempit | CODE + UNIT (tes mengunci tepat 4 berkas dan perilakunya) | Ganti dengan pesan tetap (`"Gagal ..."`), catat detail ke `console.error` lewat `describeSafeError` (`lib/connectors/safe-error-log`) | Pemilik route UMKMpro (file di luar lingkup tugas ini) |
| SEC-04 | P2 | Integrasi UMKMpro memakai SATU rahasia bersama untuk semua tenant; `tenantId` diambil dari body dan ditulis dengan klien service-role (bypass RLS). Pemegang token bisa menulis ke tenant mana pun. Tanpa nonce (replay dalam 5 menit; efeknya dibatasi idempotensi `external_event_id` untuk konversi/webhook, tetapi `promotions` membuat handoff baru). Rate limit 60/menit/route hanya di memori. Rute dikecualikan dari gating sesi di `proxy.ts` | CODE + UNIT | Pastikan `UMKMPRO_SERVICE_TOKEN` acak panjang dan hanya di Netlify (UNKNOWN apakah terisi); rotasi saat staf berubah; jangka menengah tambah nonce/cache idempotensi dan pembatasan IP asal | Founder (konfigurasi), kode: `lib/umkmpro/*` |
| SEC-05 | P3 | `/api/internal/jobs/process` menjawab 503 dengan nama variabel env (`JOBS_PROCESSOR_SECRET`, `SUPABASE_SECRET_KEY`) sebelum memeriksa Bearer; route UMKMpro serupa (`UMKMPRO_SERVICE_TOKEN kosong`). Route jobs hanya terjangkau pengguna login (proxy), route UMKMpro terjangkau siapa pun: menyingkap status konfigurasi | CODE | Pesan generik "Layanan belum dikonfigurasi" tanpa nama env | Pemilik route; `lib/umkmpro/route-helpers.ts` |
| SEC-06 | P2 | Pembatas laju seluruhnya in-memory per instance serverless (daftar, OTP, demo, ekspor ops, staf). Pada Netlify setiap instance punya hitungan sendiri, jadi ini rem, bukan jaminan (diakui di kode dan T5) | CODE | Pada 10 tenant dapat diterima; bila dibutuhkan, simpan hitungan di tabel DB atau KV. Jangan dijadikan satu-satunya kontrol biaya: batas pengeluaran penyedia AI (G5) tetap wajib | Founder (G5), kode nanti |
| SEC-07 | P2 | CSP Report-Only, mengizinkan `'unsafe-inline'` dan `'unsafe-eval'`, tanpa `report-uri`; tidak ada `form-action`. HSTS tanpa `includeSubDomains`. Perlindungan XSS lapis kedua belum aktif (T7) | CODE + UNIT | Kumpulkan pelanggaran, hapus `unsafe-eval` bila Next mengizinkan, tambah `form-action 'self'`, lalu ganti ke CSP enforced | Founder menyetujui; `next.config.ts` |
| SEC-08 | P2 | Kerentanan dependensi tidak terukur: `npm audit` tidak terjangkau dari lingkungan ini; tidak ada `.github/dependabot.yml` | UNKNOWN | Aktifkan Dependabot alerts (Settings > Code security, dari HP) dan tambahkan `dependabot.yml` | Founder (HP) |
| SEC-09 | P3 | Aksi GitHub memakai tag bergerak (`actions/checkout@v4`, `actions/setup-node@v4`), bukan SHA. Workflow bersecret sudah benar: `workflow_dispatch` saja, hanya `main`, terikat Environment, input lewat `env` (dikunci tes baru) | CODE + UNIT | Pin ke SHA bila ingin ketat | Pemilik CI |
| SEC-10 | P3 | Project ref Supabase produksi bersama ada di berkas publik (bagian 1). Bukan rahasia; kontrol nyatanya RLS. Advisor Supabase bulan Agustus mencatat RPC `SECURITY DEFINER` yang dapat dipanggil `anon` milik UMKMpro (`docs/SECURITY.md` baris 70). Status saat ini: UNKNOWN (tidak boleh menyentuh Supabase) | CODE (referensi) / UNKNOWN | Founder atau sesi baca-saja terpisah menjalankan advisor keamanan dan mencatat hasilnya | Founder |
| SEC-11 | P3 | Komentar basi: `app/api/internal/payments/sweep/route.ts` masih berkata `proxy.ts` memblokir jalur ini, padahal `proxy.ts` sudah punya eksempsi persis-sama (tes `proxy-sweeper-exemption` ada). Bukan celah, risiko salah paham | CODE | Perbarui komentar | Pemilik route |

Catatan regex statis `isPublicAsset`: ekstensi `.js|.css|.map|...` dikecualikan dari gating untuk path apa pun yang berakhiran itu. Tidak dapat dieksploitasi hari ini karena tidak ada route yang URL-nya berakhiran ekstensi itu; tes registry kini memeriksa setiap URL route terhadap `isPublicAsset`, sehingga route baru semacam itu akan terdeteksi.

## 4. Tinjauan tes: jalur kritis dan celah regresi

| Jalur | Tes yang sudah ada | Celah regresi yang ditemukan | Tindak lanjut |
|---|---|---|---|
| Pendaftaran | `schemas/auth`, `register-form*`, `otp-actions`, `auth-existing-account`, `auth-signup-error`, `rate-limit`, `safe-next`, route callback/confirm | (a) tidak ada tes bahwa pembatas daftar memakai IP tepercaya (SEC-01) dan login terbatas (SEC-02); (b) tidak ada batas jumlah tenant (fitur tidak ada, P1-2 dokumen soft launch) | Dikunci tes baru `security-auth-abuse-controls`; (b) butuh rancangan Founder |
| Kuota AI/trial | `ai-jobs`, `ai-jobs-cost`, `billing-trial`, `demo-ai-usage`, migrasi S1 (statis), job PG sekali pakai di CI (INTEGRATION) | Tes PG memakai Postgres sekali pakai, bukan Supabase nyata (G3 hijau di produksi: UNKNOWN). Guard peran `#48` belum diterapkan (G15) | Tidak ada tes unit baru yang bernilai; tetap tindakan Founder (G3, G15) |
| Gate S1 (anggaran eksternal) | `external-budget-guard`, `budget-write-callsites`, `one-click-ads-mock-e2e-gate-closed`, `meta-campaign-spec`, `own-host-url-guard` (daftar platform kosong dan beku) | Tidak ditemukan celah; daftar kosong dipin di 4 tempat | Tidak ada |
| Pembayaran fail-closed | `payment-webhook*`, `checkout*`, `get-payment-provider`, `null-payment-provider`, `midtrans-live-flag`, `doku-*`, `payment-sweeper`, `proxy-sweeper-exemption` | Urutan "belum terkonfigurasi, verifikasi, parse, tulis" pada webhook tidak dikunci sebagai urutan; eksempsi proxy untuk webhook tidak dikaitkan ke daftar route | Dikunci `security-route-registry` (urutan indeks pada `services/payment-webhook.ts`, eksempsi per route). Pin `PAYMENT_LIVE_ENABLED` kosong di `.env.example` |
| Isolasi tenant lintas route | `admin-isolation`, `oauth-tables-tenant-filter-guard`, `optimization-tenant-scope`, `oauth-credentials-tenant-scope`, PG `c4-tenant-isolation` | Tidak ada tes yang menjamin SEMUA server action mengautentikasi, atau bahwa tidak ada route baru tanpa autentikasi | `security-tenant-binding`, `security-route-registry` |
| E2E | `tests/e2e/README.md` hanya kerangka; ada `one-click-ads-mock-e2e-*` (MOCK) | Belum ada E2E browser nyata (REAL E2E: belum ada) | Di luar tugas |

Tes baru (semua UNIT, tanpa jaringan, tanpa database):

| Berkas | Isi |
|---|---|
| `security-route-registry.test.ts` | Daftar 22 route + mekanisme autentikasi + keselarasan eksempsi `proxy.ts` + urutan verifikasi sebelum klien privilese |
| `security-tenant-binding.test.ts` | Tidak ada tenant dari request; semua server action mengautentikasi; kueri kredensial service-role memfilter tenant |
| `security-open-redirect.test.ts` | 18 vektor pada dua route + penolakan tipe OTP selain `signup` |
| `security-error-leak.test.ts` | Mengunci tepat 4 route yang membocorkan `err.message` (SEC-03) dan perilaku 500 saat ini |
| `security-auth-abuse-controls.test.ts` | Bukti SEC-01/SEC-02 sebagai keadaan saat ini + kontrol yang sudah berlaku |
| `security-repo-hygiene.test.ts` | Pola rahasia, berkas `.env`, `.env.example`, keamanan workflow pada repo publik |

Cara kerja kunci "keadaan saat ini": tes lulus selama celah ada dan GAGAL saat celah ditutup; pesan kegagalan memberi tahu bahwa tes perlu dibalik menjadi penjaga perbaikan. Itu disengaja, bukan tanda regresi.

## 5. Risiko soft launch 10 tenant, berperingkat

| # | Risiko | Pri | Bukti | Mitigasi |
|---|---|---|---|---|
| 1 | Biaya AI tak terbatas bila batas pengeluaran penyedia belum dipasang (demo publik + trial; pembatas hanya in-memory) | Tinggi | CODE; nilai dashboard penyedia: UNKNOWN | G5: pasang batas bulanan di dashboard penyedia (Founder, HP) |
| 2 | Trial-farming dan tebak OTP lewat pemalsuan IP (SEC-01), tanpa batas jumlah tenant | Sedang | CODE + UNIT | SEC-01, P1-2; batas 10 tenant sebagai aturan operasional |
| 3 | Tebak sandi login tanpa rem aplikasi (SEC-02) | Sedang | CODE + UNIT | Batas Supabase 150 token/5 menit/IP sementara; SEC-02 |
| 4 | Proyek Supabase dibagi dengan PUBLOE/UMKMpro: kesalahan RLS di satu produk berdampak ke yang lain; ref publik; advisor lama mencatat RPC anon | Sedang | CODE; status sekarang UNKNOWN | SEC-10: jalankan advisor baca-saja dan catat |
| 5 | Kegagalan senyap: tidak ada pelacak error, `/api/health` dan `/api/ready` hanya probe | Sedang | CODE | P1-4; pasang UptimeRobot (G6, G7) |
| 6 | Penghapusan data/PDP: tidak ada fungsi penghapusan per tenant, kontak eskalasi kosong | Sedang | CODE | P1-7, G6 (Founder) |
| 7 | CSP belum enforced, dependensi tak dipantau (SEC-07, SEC-08) | Rendah-sedang | CODE / UNKNOWN | Aktifkan Dependabot dari HP |
| 8 | Integrasi UMKMpro memakai satu rahasia lintas tenant (SEC-04), token terisi atau tidak: UNKNOWN | Rendah-sedang | CODE + UNIT | Biarkan kosong sampai dipakai; rotasi berkala |
| 9 | Kebocoran detail galat dari 4 route UMKMpro (SEC-03) | Rendah | CODE + UNIT | Perbaikan satu baris per route |
| 10 | Jalur iklan/pembayaran nyata aktif tanpa sengaja | Sangat rendah | CODE + UNIT: daftar gate S1 kosong dan beku (dipin 4 tes), `PAYMENT_LIVE_ENABLED` kosong, webhook fail-closed | Tidak ada tindakan; jangan ubah flag tanpa persetujuan |

## 6. Tindakan Founder (semua dari HP)

Wajib sebelum undangan pertama (belum dikerjakan PR ini, sudah ada di `docs/FOUNDER_CHECKLIST_HP.md`): G5 batas pengeluaran penyedia AI, G6/G7 kontak eskalasi dan monitor. Tambahan dari audit ini:
1. Putuskan persetujuan untuk SEC-01 dan SEC-02 (perubahan `features/auth/*`). Frasa persetujuan yang dibutuhkan ditentukan Founder.
2. Aktifkan Secret scanning, Push protection dan Dependabot alerts di GitHub (Settings > Code security).
3. Cek header di produksi lewat browser (SEC-07/2.3) dan catat hasilnya.
4. Konfirmasi apakah `UMKMPRO_SERVICE_TOKEN` terisi di Netlify; bila belum dipakai, biarkan kosong.

## 7. Batas audit

Tidak diperiksa: nilai env produksi, konfigurasi Supabase/Netlify, RLS dan data produksi, kerentanan dependensi, perilaku jaringan nyata (header Netlify, validitas `x-nf-client-connection-ip`), penyedia pihak ketiga. Pemindaian rahasia hanya mencakup pola yang dikenal; rahasia tanpa pola khas (kata sandi biasa) tidak terdeteksi. Tes baru belum dijalankan di lingkungan ini (dependensi tidak terpasang); bukti lulus hanya dari CI pada PR.
