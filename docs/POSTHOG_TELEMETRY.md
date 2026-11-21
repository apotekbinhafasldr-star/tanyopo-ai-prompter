# PostHog telemetry — Fase 1 (server-only, default OFF)

**Status: DRAFT PR, integrasi MATI (default OFF). `posthog-node` 6.0.5 terpasang (exact) dan lockfile sinkron; typecheck, test, build lulus di Vercel Sandbox dan CI GitHub (bukti nyata, bukan mock shim).** Acuan desain: LINOE_POSTHOG_TELEMETRY_DESIGN_v1.0 (dokumen perencanaan Founder). Tidak ada env, secret, PostHog, database, atau production yang diubah oleh kode ini.

## Cakupan
- Hanya `posthog-node`, hanya server. Tanpa `posthog-js`, autocapture, session replay, browser telemetry, atau Error Tracking native.
- Dua event, keduanya dari `services/ai-jobs.ts` (`runAiJob`), hanya setelah baris job benar-benar tertutup: `closeAiJob` sukses DAN pembacaan read-only (tenant + id) mengamati status akhir yang sesuai (lihat "Keakuratan event"):
  - `ai_job_finished`: `job_type`, `status` (`completed|failed`), `error_category?`, `model`, `duration_bucket`.
  - `app_error`: `surface`, `error_name`, `error_category`, `http_status?`, `route_group`.
- Properti umum: `env`, `app_version`, `tenant_hash`.
- Biaya dan token **tidak** dikirim. Ledger `prompter_ai_jobs` tidak berubah.
- `app_error` Fase 1 hanya dari jalur kegagalan AI job (satu-satunya jalur server yang sudah punya klasifikasi aman). Jalur lain menunggu audit terpisah.

## Perilaku
| Aspek | Perilaku |
| --- | --- |
| Default | OFF. Tanpa `POSTHOG_TELEMETRY_ENABLED=true` + key valid + salt >= 32 karakter: no-op, SDK tidak dimuat, tidak ada request jaringan |
| Identitas | `distinctId` = `tenant_hash` = HMAC-SHA256(tenant_id, `POSTHOG_ID_SALT`) dipotong 32 hex; `system` bila tanpa tenant |
| Profil orang | Dimatikan per event (`$process_person_profile: false`); tidak pernah memanggil identify/alias/groupIdentify |
| GeoIP | `disableGeoip: true` di klien dan per event |
| Validasi | `z.strictObject`: satu properti asing = seluruh event DITOLAK (tidak dibuang sebagian); nama event asing ditolak; log hanya kode isu + path |
| Pengiriman | `captureImmediate`, `flushAt:1`, `flushInterval:0`, `fetchRetryCount:0`, `requestTimeout:1500`, batas total ~1 detik |
| Dedup | Maks. satu event per (nama event + job id) per proses; uuid v5 deterministik. Lintas instance: tidak ada penyimpanan bersama; satu job hanya ditutup oleh satu pemanggilan `runAiJob`, jadi duplikat tidak muncul dari alur normal. Dedup di sisi PostHog (uuid + event + distinct_id + timestamp) bersifat eventual dan tidak dijamin |
| Fail-open | Semua kegagalan ditelan; AI job tidak pernah gagal karena telemetry |
| Circuit breaker | 3 kegagalan beruntun, lalu lewati 5 menit (per instance) |
| `proxy.ts` | Tidak boleh memakai telemetry (runtime Edge) |

## Dependensi
`posthog-node` 6.0.5 (versi pasti) di `package.json` + `package-lock.json`. Nama opsi `flushAt`, `flushInterval`, `fetchRetryCount`, `requestTimeout`, `disableGeoip` dan `captureImmediate` terbukti ada di tipe 6.0.5 (kompilasi `tsc`). Belum diuji dengan event nyata: perilaku `$process_person_profile` pada `capture` (verifikasi saat uji asap preview).

## Keakuratan event (`closeAiJob`)
`closeAiJob` mengembalikan `true` bila tidak ada write yang error; itu belum membuktikan ada baris yang berubah (UPDATE yang tersaring RLS atau tidak cocok mengubah 0 baris tanpa error). Mekanisme ledger TIDAK diubah (perilaku itu sudah ada sebelum PR ini). Agar event tidak melaporkan status yang tidak terjadi, telemetry hanya mengirim bila pembacaan read-only (`getAiJobProvenance`, tenant + id, batas 1 detik) mengamati status akhir yang diharapkan (`COMPLETED`/`FAILED`). Pembacaan itu tidak dilakukan sama sekali saat telemetry OFF. Bila baca gagal, lambat, atau tidak konklusif: event tidak dikirim (telemetry boleh kurang-hitung, tidak pernah salah-lapor). Temuan terpisah, di luar cakupan PR ini: update 0 baris pada jalur klien juga tidak memicu retry admin sehingga job bisa tertinggal `PROCESSING`; perlu audit regresi dan persetujuan sebelum ledger disentuh.

## Batas waktu
Satu anggaran waktu (~1 detik) mencakup pemuatan SDK lazy (`getTransport`) DAN pengiriman; rejection terlambat setelah timeout ditangani agar tidak menjadi unhandled. Verifikasi baca status juga dibatasi 1 detik.

## Mengaktifkan (hanya setelah persetujuan Founder, langkah terpisah)
1. Putuskan region (D1) dan selesaikan tinjauan hukum + pembaruan `/privacy` + `docs/LEGAL_PSE_CHECKLIST.md`.
2. Set batas biaya PostHog; cek ulang kuota gratis.
3. Di Netlify (persetujuan env terpisah): set `POSTHOG_API_KEY`, `POSTHOG_ID_SALT` (acak, >= 32 karakter), `POSTHOG_TELEMETRY_ENABLED=true`. Mulai dari context preview dengan `POSTHOG_ENV=preview`.
4. Uji asap di preview (persetujuan terpisah), saring data uji dengan `env=preview`.
5. Aktifkan production hanya setelah persetujuan merge dan deploy terpisah.

## Mematikan
L1: kosongkan `POSTHOG_TELEMETRY_ENABLED` (atau hapus env) lalu deploy ulang. L2: cabut/putar key di PostHog (tanpa deploy). L3: revert PR. Circuit breaker menghentikan pengiriman otomatis bila PostHog gagal.

## Catatan audit (21 Nov 2026)
- `after()`: dokumentasi Netlify menyebut `next/after` didukung penuh. Kode ini tetap tidak bergantung padanya (pengiriman di-await dengan batas ~1 detik); boleh dipertimbangkan setelah uji preview.
- Gagal memuat SDK tidak di-cache: percobaan berikutnya boleh pulih.
- Dua event pada jalur gagal dikirim bersamaan (maks. ~1 detik, bukan 2).
