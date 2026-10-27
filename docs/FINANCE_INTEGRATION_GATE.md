# LINOE Finance & Tax Center: gerbang integrasi PR #61–#65

Dokumen ini hanya merangkum kesiapan dan langkah aman. Tidak ada yang digabung, dideploy, atau diterapkan ke production.

## Urutan merge (tumpukan PR, tiap PR menumpang pada PR sebelumnya)
#61 (base `main`) → #62 → #63 → #64 → #65. Gunakan **merge commit** (bukan squash), karena squash mengubah riwayat dan membuat PR di atasnya konflik. Setelah tiap merge, ubah base PR berikutnya ke `main` (atau biarkan GitHub mengubahnya bila cabang dihapus), tunggu CI hijau, baru lanjut.

## Urutan migrasi (tidak boleh dibalik; semuanya hanya menambah objek baru `finance_*`, `acct_*`, `tax_opt_*`)
1. `20261027100000_linoe_finance_foundation.sql`
2. `20261027110000_linoe_admin_center_access.sql` (butuh 1)
3. `20261027120000_linoe_accounting_ledger.sql` (butuh 1)
4. `20261027130000_linoe_tax_optimization_approvals.sql` (butuh 1 dan 2)

Rollback dijalankan terbalik (4, 3, 2, 1); 3 dan 4 menolak jalan bila tabelnya sudah berisi data (sengaja, fail-closed).

## Provisioning akun Founder (setelah migrasi diterapkan dan disetujui Founder)
1. Founder masuk ke LINOE dengan akunnya sendiri agar barisnya ada di Authentication → Users.
2. Salin `id` (UUID) akun itu dari dasbor Supabase (bisa dari browser HP).
3. Jalankan satu kali di SQL editor Supabase, dengan persetujuan eksplisit Founder. Tidak ada email di kode:
```sql
insert into public.finance_platform_admins (user_id, role, granted_by, note)
values ('<UUID akun Founder>', 'SUPER_ADMIN', null, 'Founder');
```
Penyisipan Super Admin pertama hanya diterima bila belum ada Super Admin aktif; sesudahnya trigger menolak promosi diri dan eskalasi hak oleh siapa pun selain Super Admin lain.
4. Terakhir, set `ADMIN_CENTER_ENABLED=true` di pengaturan env hosting dan deploy. Sebelum itu semua `/admin` menghasilkan 404 dan tombol "Admin Perusahaan" tersembunyi; halaman tenant tidak menyentuh database admin.

## Tiga lapis kesiapan
- **Teknis aplikasi**: siap untuk ditinjau (lihat laporan, CI hijau di kelima PR, tes PostgreSQL 17 untuk seluruh rantai).
- **Data keuangan nyata**: BELUM siap. Belum ada data produksi; data perusahaan (`lib/admin/company-profile.ts`) seluruhnya MENUNGGU VERIFIKASI DOKUMEN; belum ada jurnal, saldo awal, atau rekening koran.
- **Penggunaan pajak nyata**: BELUM siap. Pasal 28, tarif 22%, PPN/PMK 81/2024 masih BLOCKED atau hanya dari DJP; Pasal 59 PP 55/2022 historis; lama jangka waktu PT biasa tidak terbaca; belum ada validasi akuntan atau konsultan pajak.
