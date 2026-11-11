# S1 dan quota guard: status terapan dan bukti yang dibutuhkan

Dibuat 2026-11-11 pada `main` 6287160. Level: **CODE** (membaca repo). Tidak ada akses database, tidak ada tool MCP, tidak ada query.

## 1. Status

**Status terapan S1 (tiga migrasi `20261019100000/100/200`) di database produksi: UNKNOWN.**
**Status terapan quota guard (`20261021120000/100`): UNKNOWN.** (Dokumen sumbernya sendiri menyebut "belum diterapkan".)

Dokumen ini tidak menyatakan "sudah" atau "belum" diterapkan. Yang ada hanya klaim dokumen, dan klaim bukan bukti.

## 2. Klaim yang saling bertentangan (semuanya klaim dokumen)

| Sumber | Isi | Kapan | Jenis |
|---|---|---|---|
| `docs/S1_TRIAL_AI_QUOTA.md`, baris Status | "Draft PR. NOT applied to any database." | Ditulis saat S1 masih Draft PR (commit `e965fb3`, readiness 2026-10-23) | Klaim dokumen. Menggambarkan keadaan saat ditulis, tidak diperbarui setelahnya |
| `docs/AI_JOBS_QUOTA_GUARD.md`, bagian Masalah dan "Kompatibilitas" | "S1 (sudah di production)", "S1 aktif", "Live (project `wjjyqovhmwenbcvbnkgx`, 2026-11-07)" | Commit `4835421`, 2026-11-07 | Klaim dokumen tentang pembacaan katalog. Hasil query/tangkapan layar bertanggal tidak ada di repo |
| `docs/AI_JOBS_QUOTA_GUARD_RUNBOOK.md` baris 16 | "S1 tercatat di ledger dan efektif (diperiksa preflight)" | Belum dijalankan (header runbook: "BELUM dijalankan") | Syarat yang harus dipenuhi sebelum menjalankan, bukan hasil |
| Komentar `supabase/migrations/20261029220000_prompter_p0_subscription_plan_tampering_lockdown.sql` baris 43 | Menyebut produksi saat itu belum memiliki migrasi S1 (`20261019100100`) | 2026-10-29 (versi berkas) | Klaim dokumen/komentar kode, usang bila S1 diterapkan sesudahnya |
| `docs/FOUNDER_CHECKLIST_HP.md` G3, D6 | "BELUM TERBUKTI", "Klaim dokumen; tidak diperiksa ulang" | 2026-11-11 | Penilaian ulang |
| `docs/SOFT_LAUNCH_10_TENANTS.md` G3 | "PERLU KONFIRMASI" | 2026-11-11 | Penilaian ulang |

Rekonsiliasi: kedua kalimat bisa benar pada tanggal masing-masing (draft 2026-10, lalu mungkin diterapkan sebelum 2026-11-07). Bisa juga salah satunya keliru. Repo tidak memuat catatan bertanggal yang menentukan. Karena itu status gabungan = UNKNOWN.

## 3. Bukti baca-saja bertanggal yang harus didapat

Satu catatan bukti memuat: tanggal dan jam (WIB), nama dan ref proyek yang dikonfirmasi (`umkmpro-ai`, proyek BERSAMA dengan PUBLOE/MITAPENG/UMKMpro), siapa/apa yang membaca, dan hasil per butir di bawah. Tanpa data tenant dan tanpa data pribadi. Hanya SELECT. Pembacaan butuh persetujuan Founder (lihat `docs/FOUNDER_CHECKLIST_HP.md` C4). Tidak ada yang dijalankan oleh dokumen ini.

| # | Yang dibuktikan | Hasil yang berarti "efektif" |
|---|---|---|
| E1 | Ledger `supabase_migrations.schema_migrations` | Tiga baris: versi `20261019100000`, `20261019100100`, `20261019100200` dengan nama `prompter_p0_ai_jobs_lockdown`, `prompter_p0_subscription_trial_insert_guard`, `prompter_p0_plan_entitlements_lockdown`. `cardinality(statements)=1` dan sha256 isinya sama dengan `manifest.json` wrapper |
| E2 | Hak akses (katalog) `prompter_ai_jobs` | `authenticated` dan `anon`: tanpa INSERT, DELETE, TRUNCATE dan tanpa UPDATE tingkat tabel. UPDATE tingkat kolom hanya pada 10 kolom: `status, provider, model, tokens_input, tokens_output, fallback_provider, output_reference, error, error_category, completed_at` |
| E3 | Hak akses `prompter_subscriptions` | `authenticated` dan `anon`: tanpa DELETE dan TRUNCATE. `anon`: tanpa INSERT. `authenticated`: UPDATE hanya kolom `plan` bila hanya S1 yang terpasang; tanpa UPDATE sama sekali bila `20261029220000_prompter_p0_subscription_plan_tampering_lockdown` juga terpasang (status migrasi itu juga UNKNOWN; catat keduanya) |
| E4 | Hak akses `prompter_plan_entitlements` | `authenticated` dan `anon`: tanpa INSERT, UPDATE, DELETE, TRUNCATE |
| E5 | Trigger trial | Di `pg_trigger`: `trg_prompter_subscriptions_enforce_trial_insert` pada `prompter_subscriptions`, BEFORE INSERT, aktif (`tgenabled = 'O'`). Fungsi `fn_enforce_trial_subscription_insert` bukan SECURITY DEFINER dan tubuhnya memuat `interval '14 days'`. Catat md5 `pg_get_functiondef` |
| E6 | RPC kuota | md5 `pg_get_functiondef` dari `fn_create_ai_job_if_entitled(text,jsonb)`. S1 tidak boleh mengubahnya. Klaim dokumen: `17bd1c2bee1069ca6460774e9021fa9d` (tubuh B10) berarti guard belum aktif. `2042201955b6acbae5b10999413b0e49` (runbook) berarti guard bagian 1 aktif |

Cara membaca hasil:
- E1 ada, E2 sampai E5 sesuai: "tercatat dan efektif" (bukti DB, bertanggal). Hanya saat itu G3 boleh ditandai terbukti.
- E1 ada tetapi salah satu E2 sampai E5 tidak sesuai: tercatat tetapi tidak efektif. Hentikan; jangan memperbaiki dari dashboard.
- E1 tidak ada: S1 belum diterapkan, dan klaim 2026-11-07 keliru. Penerapan hanya lewat wrapper dengan persetujuan Founder per berkas (`docs/S1_MIGRATION_WRAPPER.md`).
- Catatan bukti berusia lama (lebih dari beberapa hari sebelum undangan tenant pertama) harus diulang.

## 4. Temuan kode (label bukti)

| ID | Temuan | Label | Tingkat |
|---|---|---|---|
| F1 | `getOrCreateSubscription` (services/billing.ts) mengabaikan error insert dan select. Bila insert gagal (bentrok primary key saat dua akses pertama bersamaan, atau RLS/gangguan), fungsi mengembalikan baris TRIALING rekaan: periode = jam aplikasi, 14 hari dari sekarang, tidak tersimpan. Halaman Billing menampilkan masa coba yang tidak cocok dengan database, dan tiap muat ulang memberi "14 hari" baru | CODE + UNIT. **DIPERBAIKI di PR ini** (`fix/trial-subscription-insert`): `getOrCreateSubscription` kini memeriksa error select/insert, membaca ulang baris pemenang pada `23505`, dan melempar `SubscriptionUnavailableError` bila tidak ada baris tersimpan; `it.fails` sudah menjadi `it` (UNIT TEST, belum dijalankan CI saat ditulis; bukan bukti perilaku produksi dan bukan klaim S1 terapan) | Sedang-rendah (tampilan; penegakan kuota tetap di RPC) |
| F2 | Baris trial dibuat malas: hanya saat halaman Billing dibuka atau job AI pertama (layout tidak pernah membuatnya, onboarding juga tidak). Akibat: (a) jam trial mulai saat pemakaian pertama, bukan saat daftar; (b) tenant tanpa baris tidak pernah kena `TRIAL_EXPIRED` di `fn_activate_product` dan `fn_reserve_active_campaign_slot` (cabang `found` salah dilewati, batas FREE tetap berlaku); (c) RPC kuota menjawab `NO_SUBSCRIPTION` untuk tenant tanpa baris, hanya tertutup karena `runAiJob` memanggil `getOrCreateSubscription` lebih dulu dan mengabaikan hasilnya | CODE (membaca migrasi `20260924173424`, `20260915051359`; tidak dijalankan) | Rendah-sedang |
| F3 | `recordSingleTouchAttribution` menghapus baris lama berdasarkan `conversion_id` saja, dan jalur webhook UMKMpro memakai service role (RLS dilewati). Id berasal dari upsert tenant yang sama, jadi tidak ada jalur eksploit yang terlihat; ini kelemahan pertahanan berlapis | CODE + UNIT (`it.fails` di `tests/unit/services/tenant-scope-queries.test.ts`) | Rendah |
| F4 | Konversi manual (`features/analytics/actions.ts`) menerima `campaignId` dari formulir tanpa memastikan kampanye itu milik tenant. Jalur UMKMpro memverifikasinya (`verifyCampaignBelongsToTenant`). Kebijakan RLS konversi/atribusi hanya memeriksa `tenant_id` baris, FK tidak memeriksa tenant. Perlu menebak UUID kampanye tenant lain, jadi praktis rendah. Perilaku nyata di database: UNKNOWN | CODE (membaca kode dan migrasi) | Rendah |
| F5 | Kebijakan INSERT `prompter_brand_profiles` tidak membatasi peran (UPDATE hanya owner/marketing). Peran lain di tenant bersama yang pertama membuka `/onboarding` dapat membuat profil dan menandai onboarding selesai. Perilaku nyata: UNKNOWN | CODE (membaca migrasi `20260829080127`) | Rendah |
| F6 | Pembatas pendaftaran (5 per jam per IP) disimpan di memori proses, tidak dibagi antar instance serverless; dan S3 (anti-trial-farming) memang belum ada: email baru berarti tenant baru berarti trial baru. Sudah didokumentasikan di S1 "Not in S1" dan di `lib/rate-limit.ts`. Efek nyata di produksi: UNKNOWN | CODE | Diketahui, tidak diperbaiki |

Tidak ditemukan pada level kode: trial ganda dari jalur aplikasi lain (hanya `services/billing.ts` yang menulis `prompter_subscriptions`, satu insert; dijaga tes statis), periode yang bisa dipalsukan klien (trigger E5 memaksa waktu server, bila terpasang, UNKNOWN), kode yang menghapus atau mengubah baris subscription. Pengujian di database sungguhan tidak dilakukan.

Yang tidak dibuktikan oleh apa pun di sini: bahwa email konfirmasi terkirim, bahwa trigger pembuat tenant/profil (`handle_new_user`, dimiliki proyek bersama, tidak ada di repo) bekerja untuk pendaftar baru, dan bahwa RLS sungguhan menolak akses lintas tenant. Semuanya UNKNOWN.

## 5. Rancangan perbaikan (butuh persetujuan Founder; tidak diubah di PR ini)

Catatan: butir 1 (F1) sudah dikerjakan di PR `fix/trial-subscription-insert` atas persetujuan Founder (khusus `services/billing.ts`, pemanggilnya, dan tes). Berkas di luar lingkup: `features/onboarding/actions.ts`, `features/analytics/actions.ts`, `services/attribution.ts`.

1. (SELESAI di PR ini) `services/billing.ts#getOrCreateSubscription` (F1): periksa `error` dari select dan insert. Jika insert gagal dengan kode `23505`, baca ulang baris dan kembalikan baris itu. Jika tetap tidak ada baris, lempar error atau kembalikan null; jangan pernah mengembalikan baris yang tidak tersimpan. Pemanggil (`billing/page.tsx`, `runAiJob`) menampilkan "Gagal memuat paket, coba lagi" / menolak job. Setelah itu ubah dua `it.fails` di tes menjadi `it`.
2. `features/onboarding/actions.ts#completeOnboardingAction` (F2): panggil `getOrCreateSubscription` sekali setelah upsert profil berhasil, supaya trial mulai pada saat yang pasti dan tenant selalu punya baris. Idempoten karena baris yang ada dikembalikan apa adanya.
3. `services/attribution.ts` (F3): tambahkan `.eq("tenant_id", input.tenantId)` pada delete. Lalu ubah `it.fails` menjadi `it` dan hapus entri `attribution.ts|prompter_attributions|delete` dari daftar `REVIEWED` di tes.
4. `features/analytics/actions.ts` (F4): sebelum insert, cek `prompter_master_campaigns` dengan `.eq("id", campaignId).eq("tenant_id", session.tenantId)`; tolak bila tidak ada.
5. F5: tambahkan pemeriksaan peran owner/marketing di `completeOnboardingAction` dan `skipOnboardingAction`, atau sesuaikan kebijakan INSERT lewat migrasi (migrasi: terlarang tanpa persetujuan).

## 6. Tes yang ditambahkan (UNIT, tanpa database)

- `tests/unit/services/auth-trial-subscription.test.ts`: bentuk insert trial kanonik (14 hari, tanpa kolom plan/billing), baris yang ada tidak disentuh, tidak ada update/delete/upsert, hanya satu penulis `prompter_subscriptions` di kode aplikasi, dan tes F1 (konflik 23505 membaca baris pemenang, galat select/insert dilempar sebagai `SubscriptionUnavailableError` tanpa trial rekaan, tanpa kebocoran detail DB).
- `tests/unit/services/auth-trial-callers.test.ts`: `runAiJob` gagal tertutup (pesan Indonesia, tanpa RPC kuota, tanpa job, tanpa panggilan AI) bila langganan tidak tersedia. Halaman Billing menangkap galat yang sama dan menampilkan keadaan galat ramah; belum ada tes render halaman (UNKNOWN).
- `tests/unit/services/tenant-scope-queries.test.ts`: pembacaan billing terfilter `tenant_id`, penjaga statis seluruh query di `services/*.ts` (kueri tanpa filter tenant harus ada di daftar tinjauan beralasan), dan satu `it.fails` untuk F3.

Hasil tes ini adalah UNIT TEST PASS pada CI, bukan bukti perilaku produksi.
