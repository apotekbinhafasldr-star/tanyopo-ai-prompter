# Jalur kritis soft-launch trial 14 hari (audit kode, Draft)

Status: **DOKUMEN (Draft)**, diperiksa 2026-11-15 terhadap `origin/main` `d19232a`. Tidak ada akses env/Netlify/database produksi, tanpa SQL, tanpa merge.
Kelas bukti: **CODE** (dibaca di kode) / **UNIT** (tes unit) / **INTEGRATION** (tes SQL di CI, PG17 lokal) / **MOCK** / **SANDBOX** / **REAL** / **UNKNOWN**.
**REAL e2e signup belum ada** (QA-2 belum aktif). Tidak ada klaim "CUSTOMER READY". Ini bukan nasihat hukum.

## 1. Jalur soft-launch di `main` (CODE/UNIT; bukan REAL)

| Tahap | Perilaku di kode | file:baris | Bukti | Catatan |
|---|---|---|---|---|
| Daftar | Pembatas 5/jam/IP (memori per instance), `signUp` tanpa `emailRedirectTo`, kotak setuju wajib | `features/auth/actions.ts:28,168-170,185` | CODE+UNIT | IP bisa dipalsukan bila header tak dikunci (SEC-01, #141) |
| Konfirmasi email | Tautan template -> `/auth/confirm` -> `verifyOtp` -> `next` aman; gagal -> `/login?notice` | `app/auth/confirm/route.ts:39-53`; `proxy.ts:39,68-69` | CODE+UNIT | Pengiriman email nyata = **UNKNOWN** (SMTP, G4) |
| Onboarding | Tenant dari `fn_current_tenant_id`; profil merek disimpan; bisa dilewati | `features/onboarding/actions.ts:21-57,93-98` | CODE+UNIT | Konflik dengan #133 (lihat bagian 4) |
| Dashboard + banner | Banner hanya MEMBACA langganan, tidak membuat baris; gagal = banner tersembunyi | `app/(app)/layout.tsx:20-27` | CODE | Trial baru dibuat saat Billing dibuka / AI pertama |
| Trial 14 hari | Baris `TRIALING`, `now()+14 hari`; trigger DB memaksa periode oleh jam server (klien tak bisa memalsukan) | `services/billing.ts:13,37-90`; `supabase/migrations/20261019100100_...insert_guard.sql:64-65` | CODE+INTEGRATION (`s1-wrapper-pg17`, `s1-trial-quota-sql`) | Aktif di produksi = **UNKNOWN** (G3) |
| Tanpa reset | Tidak ada jalur reset/perpanjang di kode; UPDATE/DELETE/TRUNCATE dikunci migrasi | `20261029220000_...plan_tampering_lockdown.sql`; `plan-tampering-sql` CI | INTEGRATION | Kebijakan trial tidak diubah |
| Batas AI | 30/trial atomik di RPC; ke-31 ditolak, tanpa panggilan AI | `services/ai-jobs.ts:167-188`; `lib/billing/plans.ts:63`; tes `ai-jobs.test.ts:96,114` | UNIT+INTEGRATION | Biaya total tak berbatas di kode (G5) |
| Akhir trial | `TRIAL_EXPIRED` menolak AI/jalur berbayar; `getTrialState` | `20260924173424_...gate_fix.sql:53,128`; `services/billing.ts:103-115` | INTEGRATION+UNIT | |
| Bayar pertama | Sisa trial (maks 14 hari) ditambahkan, tidak hangus | `20261030100100_...carryover.sql:25-26` | INTEGRATION | Hanya relevan setelah pembayaran aktif |
| Pembayaran OFF | Tanpa `PAYMENT_PROVIDER_NAME` provider kosong; live butuh dua saklar | `lib/billing/get-payment-provider.ts:32-39`; `midtrans-payment-provider.ts:54`; `doku-payment-provider.ts:147` | CODE+UNIT | Nilai env produksi = **UNKNOWN** |

## 2. Hasil audit

### A. Bug kode terbukti
| ID | Temuan | Status |
|---|---|---|
| F1 | `getOrCreateSubscription` di `main` (`services/billing.ts:60-79`) mengembalikan trial rekaan dari jam aplikasi bila insert/select gagal (galat RLS, jaringan); trial itu tak tersimpan di DB, tampil di Billing dan membuat AI jalan tanpa baris langganan. | **Diperbaiki di PR ini**: gagal-tertutup (`SubscriptionUnavailableError`), tabrakan 23505 membaca baris pemenang, Billing menampilkan galat ramah, `runAiJob` menolak dengan pesan umum. Kode identik dengan Draft #140 agar tidak konflik bila #140 digabung kemudian. Tes UNIT/MOCK. |
| F2 | Aman tapi perlu dicatat: trial dimulai saat Billing pertama dibuka / AI pertama, bukan saat daftar | Bukan bug; DB tetap memaksa 14 hari dari saat baris dibuat |

### B. Blocker konfigurasi / persetujuan Founder
| # | Blocker | Bukti |
|---|---|---|
| B1 | `ADMIN_CENTER_ENABLED` dilaporkan `true` di produksi per 13 Nov (G11 mensyaratkan kosong). Kode hanya aktif bila persis `"true"` (`lib/admin/flag.ts:8`); isi hanya data DEMO. Kosongkan/hapus; cek `PAYMENT_PROVIDER_NAME`, `PAYMENT_LIVE_ENABLED` juga kosong | Laporan koordinator; nilai env tak diverifikasi di sini |
| B2 | Situs publik tanpa Netlify SSO (login terbuka dari jendela penyamaran) | Dokumen C5; **UNKNOWN** |
| B3 | Supabase Auth: Site URL, Redirect URLs, template "Confirm signup", **SMTP kustom** (SMTP bawaan hanya ke anggota tim, 2 email/jam) | G4; **UNKNOWN**; durasi setup domain/SMTP **UNKNOWN** |
| B4 | Batas biaya AI bulanan di dashboard penyedia | G5, C1 |
| B5 | Migrasi S1 terbukti ada di ledger produksi (baca-saja) | G3; ditulis "sudah di production" per 2026-11-07, belum diperiksa ulang |
| B6 | Keputusan jalur PSE/TDPSE (tunda undangan atau risiko sadar) | G9 |
| B7 | **LPE/PJP belum didaftarkan di Komdigi (fakta Founder)**: pembayaran live **bukan syarat** soft-launch (semua tenant gratis, `PAYMENT_LIVE_ENABLED` kosong). Tenggat izin = **UNKNOWN**; lihat `docs/audit/ADO_LPE_AUDIT.md` (Agen 4) | `docs/LEGAL_PSE_CHECKLIST.md` |
| B8 | **AEO/GEO belum terhubung ke situs (fakta Founder; Agen 3)**: bukan syarat soft-launch undangan pribadi; hanya relevan untuk promosi publik | PR Agen 3 |
| B9 | Kontak eskalasi RUNBOOK, UptimeRobot, smoke test produksi, backup (G6, G7, G12, G8) | Dokumen C2, C3 |

### C. UNKNOWN
Pengiriman email nyata; isi env produksi; S1 aktif saat ini; kelayakan SMTP; durasi deploy Netlify; tenggat LPE/PJP; status review aplikasi Meta/TikTok/X (tak diminta, G13); REAL e2e signup. Kegagalan `QA-2 schema apply` (workflow_dispatch, 14 Nov 09:43 dan 15:56 UTC) pada `main`: penyebab belum dibaca; workflow manual untuk proyek QA, bukan CI `main`.

## 3. Status Draft PR (basis `main` d19232a; konflik dihitung dengan `git merge-tree`)

| PR | Isi | Konflik vs main | CI | Perlu untuk soft-launch? |
|---|---|---|---|---|
| #136 | Audit trial/tenant-scope (tes+docs) | bersih | hijau | Disarankan (dasar #140) |
| #140 | Fix F1; basis cabang #136 (bukan main) | bersih (tumpuk di #136) | hijau | **Ya, F1**; PR ini mengambil alih ke `main` |
| #139 | Audit keamanan (tes) | bersih | hijau | Disarankan (dasar #141) |
| #141 | SEC-01/02 IP tepercaya + pembatas login; basis #139 | **konflik** `features/auth/actions.ts` | hijau | Ya (anti-penyalahgunaan daftar) setelah rebase |
| #134 | AI fail-safe (`ai-jobs.ts`) | bersih | hijau | Ya (kebocoran galat, job macet); `ai-jobs.ts` dekat F1 |
| #135 | Ads-engine campaign_limit | bersih | hijau | Disarankan |
| #133 | UI mobile 360 | **konflik** `onboarding-wizard.tsx` | hijau (basis lama) | Disarankan; perlu rebase |
| #142 | Integrasi #133-#140 | **konflik** `onboarding-wizard.tsx` | hijau | Jangan digabung bersama paket terpisah (duplikasi) |
| #31/#45/#46/#48/#44 | P0 lama (anti-trial-farming, privilege, kuota, checkout) | **konflik** (`ci.yml`, dll.) | hijau di basis lama | Tidak untuk soft-launch gratis; #48 = G15 opsional; #44/#45 hanya untuk bayar |
| #43 | Kesiapan P0 (footer, harga jujur) | **konflik** halaman marketing | hijau (basis lama) | Bersinggungan dengan Agen 3 |
Tidak ada yang sudah di `main` (semua `open`). Konflik berasal dari perubahan `main` setelah PR dibuka.

## 4. Urutan merge yang disarankan (Founder menggabung, AI menyiapkan rebase)
1. PR ini (F1, kecil, bersih) -> 2. #136 dan #139 (tes/doc) -> 3. #134 (rebase bila `ai-jobs.ts` bentrok) -> 4. #141 (rebase `actions.ts`) -> 5. #135 -> 6. #133 (rebase wizard). Setelah PR ini masuk, #140 menjadi duplikat: tutup oleh pemiliknya, bukan oleh agen ini.
Tiap merge menunggu CI hijau (bukti: run `CI` push 14 Nov berlangsung sekitar 4 menit, `08:57-09:01`).

## 5. Jalur kritis dan tanggal paling cepat

| Langkah | Pemilik | Durasi |
|---|---|---|
| 1. Kosongkan `ADMIN_CENTER_ENABLED`; lihat env pembayaran (B1) | Founder | UNKNOWN (menit dari HP, tanpa bukti) |
| 2. Gabung PR berurutan (bagian 4) + deploy | Founder (AI rebase) | CI ~4-10 menit per PR; deploy UNKNOWN |
| 3. SSO mati, Auth Site URL/Redirect/SMTP kustom, uji email ke Gmail non-tim (B2, B3) | Founder | **UNKNOWN** (pengaturan domain/SMTP) |
| 4. Batas biaya AI, konfirmasi S1 baca-saja, kontak RUNBOOK, UptimeRobot (B4, B5, B9) | Founder + sesi baca AI | UNKNOWN |
| 5. Keputusan PSE tertulis (B6) | Founder | UNKNOWN |
| 6. Smoke test produksi hijau, lalu undang tenant pertama | Founder | UNKNOWN |

**Soft-launch trial tanpa pembayaran live: paling cepat Selasa 2026-11-17**, hanya bila langkah 1-6 selesai Minggu-Senin (15-16 Nov) tanpa hambatan.
Asumsi: Founder tersedia dan memberi persetujuan eksplisit; SMTP kustom langsung berfungsi; S1 terkonfirmasi aktif; keputusan PSE = risiko sadar atau sudah diputuskan; tidak ada kegagalan smoke test. Tanggal ini adalah batas bawah teoretis, bukan janji; **tanggal pasti = UNKNOWN** karena langkah 3 dan 5 tak punya bukti durasi.
**Pembayaran live: UNKNOWN** (LPE/PJP belum didaftarkan; tak ada bukti lama proses). Tidak boleh menahan soft-launch gratis dan tidak boleh dijanjikan ke tenant.
