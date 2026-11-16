# QA-2 admin client (inert)

`scripts/qa/qa-admin-client.mjs` -> `createQaAdminClient({ url, secretKey, expectedRef, identityEmail, fetchImpl? })`.
Hanya untuk runner QA server-side; TIDAK dihubungkan ke `real-e2e.mjs` main() (wiring ditunda). Tanpa dependensi baru.

## Penjaga (fail-closed saat konstruksi)
- `url` persis `https://gasdqsadnjoknisloaec.supabase.co` (ref di allowlist, == `expectedRef`, bukan ref produksi/bersama; `.supabase.com`, slash akhir, path ditolak).
- `secretKey` wajib; hanya hidup di closure (tidak ada properti/getter), dikirim sebagai header, disamarkan (`redact`) di semua galat. Galat hanya memuat op, status HTTP, kode PostgREST.
- `identityEmail` = satu alamat `@qa.tanyopo.com` tanpa plus-address (`isLockedQaAddress` dari guard).
- Semua metode menolak email selain `identityEmail` persis; tidak ada list/bulk; objek dibekukan.
- Timeout 10 dtk, respons maks 256 KiB, `redirect: error`, tanpa retry.

## Operasi
- `findUserByEmail(email)` -> `{id}|null` (GET `/auth/v1/admin/users?filter=<email>`, cocok eksak).
- `getTrial(email)` -> `{status, plan, trial_ends_at}|null`, hanya baca `public.prompter_subscriptions`
  (`current_period_end` dipetakan ke `trial_ends_at`; tabel tidak punya kolom `trial_ends_at`). Tidak ada fungsi mengubah/memperpanjang trial.
- `resetIdentity()` / `deleteUser(id)` (id harus identitas QA): lookup user -> `user_profiles.tenant_id` ->
  DELETE `prompter_subscriptions?tenant_id=eq.<tid>` -> DELETE `tenants?id=eq.<tid>` (cascade ke tabel `prompter_*`) -> DELETE `/auth/v1/admin/users/<uid>`.
  Idempoten: tanpa pengguna = tanpa DELETE.

## UNKNOWN (tidak ditebak; galat bila terjadi)
- `tenants`/`user_profiles` milik UMKMpro AI, tidak ada di repo: FK `user_profiles.tenant_id` mungkin menghalangi DELETE tenant (kemudian reset gagal, tanpa menghapus user).
- Tabel non-`prompter_` (mis. `finance_*`, `acct_*`) dengan FK tenant yang tidak cascade: tidak diketahui.
- Trigger penjaga/RLS pada `prompter_subscriptions` terhadap DELETE service_role: tidak diverifikasi (tanpa jaringan).
- Dukungan parameter `filter` GoTrue admin pada versi proyek QA; bila diabaikan dan halaman penuh tanpa cocok, `findUserByEmail` melempar "ambigu".
- Tenant dengan anggota lain selain identitas QA: reset dibatalkan (UNKNOWN). Tenant yatim (user sudah terhapus) tidak dapat ditemukan lagi.
- Orkestrator membaca `trial_ends_at`; sumber sebenarnya `current_period_end` (dipetakan di client ini).
