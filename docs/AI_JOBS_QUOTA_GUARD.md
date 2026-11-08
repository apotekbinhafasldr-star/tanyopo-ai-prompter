# AI Jobs quota guard (Draft, rebased on main)

Status: Draft PR, **belum diterapkan di database mana pun**. Isi SQL migrasi sama persis dengan PR #48
(`de0761f`); yang diubah hanya: rebase ke `main` (S1 sudah ada di tree), rollback 1, tes, CI, dan alat eksekusi.
Runbook eksekusi: `docs/AI_JOBS_QUOTA_GUARD_RUNBOOK.md`.

## Masalah (direproduksi di PostgreSQL lokal sintetis)
- `fn_create_ai_job_if_entitled` SECURITY DEFINER tanpa cek peran: user mana pun di tenant (apoteker, kasir, admin_gudang, hr, ...)
  bisa memakai kuota AI tenant, padahal kebijakan tabel hanya mengizinkan owner/marketing.
- `job_type` / `input_reference` tidak divalidasi RPC (2 MB diterima).
- Kuota = jumlah baris `prompter_ai_jobs` pada periode; hak akses yang bocor di masa depan bisa mereset kuota.
  **S1 (sudah di production) menutup ini lewat hak akses**; guard ini lapisan kedua (trigger) yang bertahan bila hak akses mundur.

## Yang diubah PR ini
| Bagian | Migrasi | Efek |
|---|---|---|
| 1 | `20261021120000_prompter_ai_jobs_quota_guard.sql` | RPC (signature/hitungan sama): `ROLE_NOT_ALLOWED` (bukan owner/marketing, dari `fn_current_role()`/`auth.uid()`), `INVALID_JOB_TYPE` (6 tipe app), `INVALID_INPUT` (bukan objek atau > 64 KiB), blok fail-closed `ENTITLEMENT_NOT_CONFIGURED`. Trigger BEFORE UPDATE (`id, tenant_id, actor_user_id, job_type, input_reference, created_at` immutable untuk anon/authenticated) dan BEFORE TRUNCATE. Tanpa GRANT/REVOKE. |
| 2 | `20261021120100_prompter_ai_jobs_delete_guard.sql` | Trigger BEFORE DELETE untuk anon/authenticated. **Menolak berjalan** bila `authenticated` masih punya DELETE (S1 belum efektif) atau bagian 1 belum aktif. |

## Kompatibilitas dengan S1 dan keadaan live (dibuktikan, read-only)
- Live (project `wjjyqovhmwenbcvbnkgx`, 2026-11-07): RPC md5 `17bd1c2bee1069ca6460774e9021fa9d` = tubuh B10 di repo (tidak ada migrasi lain yang
  mendefinisikan ulang RPC setelah B10; tes unit menjaga ini). Guard = B10 + penambahan saja; perilaku trial/entitlement/PAST_DUE/CANCELED
  identik (tes paritas 9 skenario sebelum/sesudah).
- S1 aktif: `authenticated` tanpa INSERT/UPDATE-tabel/DELETE/TRUNCATE; UPDATE hanya 10 kolom pembukuan. Kolom yang dibekukan trigger tidak
  termasuk 10 kolom itu: trigger UPDATE/TRUNCATE/DELETE kini murni *defence in depth* (tidak bentrok, tidak menghalangi alur app).
- Alur app: `services/ai-jobs.ts` memetakan `ROLE_NOT_ALLOWED`, `INVALID_*`, `ENTITLEMENT_NOT_CONFIGURED`; pelepasan job memakai admin client
  (service_role, tidak dibatasi guard). Tidak perlu deploy app.
- Versi `20261021...` lebih kecil dari maksimum ledger (`20261103170000`): tidak masalah karena wrapper mencatat versi eksplisit (seperti S1);
  jangan pakai `supabase db push`.

## Perubahan perilaku yang harus diketahui
1. Peran `apoteker`, `kasir`, `admin_gudang`, `hr` kini ditolak (`ROLE_NOT_ALLOWED`) oleh RPC. Sebelumnya lolos (celah).
2. Tidak ada baris `FREE` / alokasi NULL pada `prompter_plan_entitlements` kini ditolak (`ENTITLEMENT_NOT_CONFIGURED`), bukan "tanpa batas".
   Live: 7 plan, semua alokasi terisi.

## Rollback
`supabase/rollback/*.down.sql` (tidak otomatis). Rollback 2 hanya menghapus trigger DELETE. Rollback 1 menghapus trigger dan mengembalikan RPC ke
**tubuh B10 yang persis sama dengan live** (md5 `17bd...`; diuji). Tidak ada GRANT. (Versi #48 mengembalikan ke tubuh #31 dengan blok fail-closed;
diubah karena S1 tidak pernah memuat blok itu.)

## Tes
- `bash supabase/tests/ai-jobs-guard/run-local.sh` (job CI `ai-jobs-guard-pg17`, PostgreSQL 17): varian `s1` (rantai migrasi nyata), `pre_s1`,
  urutan repo, paritas billing, 80 panggilan paralel, idempoten, rollback persis, re-apply.
- `tests/unit/migrations/ai-jobs-quota-guard.test.ts`: invarian statis + kompatibilitas S1 + pemetaan pesan app.
- Wrapper: `supabase/tests/ai-jobs-guard/wrapper.test.mjs` dan `wrapper-local.sh` (job CI `quota-guard-wrapper-pg17`).
