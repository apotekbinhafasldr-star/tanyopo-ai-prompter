# Migrasi production via GitHub Actions (persetujuan Founder)

Status: **dibuat, belum dipakai.** Tidak ada secret, role, atau Environment yang dibuat oleh PR ini. Tidak ada SQL production yang dijalankan.
Project yang dituju: `umkmpro-ai` (`wjjyqovhmwenbcvbnkgx`), **BERSAMA PUBLOE/UMKMpro**.

## Prinsip
- Hanya `workflow_dispatch` (dijalankan manual). Tidak ada auto-apply saat push, merge, atau PR.
- Production berubah hanya setelah **persetujuan Founder di GitHub Environment `production-migration`**.
- Workflow hanya menjalankan **paket yang tercantum di `supabase/prod-packages/manifest.json`**. Tidak pernah memindai folder migrasi, tidak memakai Supabase CLI, tidak pernah `db push` / `migration up`.
- Berhenti (STOP) pada pemeriksaan pertama yang gagal. Tidak ada rollback otomatis.
- Paket P0-2 dipasang **tanpa backfill**: dua transaksi Xendit lama tetap tanpa invoice dan tidak disentuh.

## Audit keamanan repository PUBLIC
| Risiko | Pengendali |
|---|---|
| Orang lain memicu workflow | Hanya pemegang akses tulis yang bisa menjalankan `workflow_dispatch`; job dilewati jika bukan `main`; Environment membatasi branch ke `main`. |
| Workflow diubah di branch lalu dijalankan dengan secret | Secret hanya ada di Environment (bukan repo). Environment dibatasi ke `main`; job punya `if: github.ref == 'refs/heads/main'`. |
| PR dari fork mencuri secret | Workflow production tidak punya pemicu PR. `ci.yml` tidak memakai secret sama sekali (diuji). |
| Log publik membocorkan data | Runner hanya mencetak nama pemeriksaan, PASS/FAIL, jumlah, dan hash. Password tidak pernah dicetak dan disamarkan; pesan error dibersihkan dari password (diuji). |
| Script injection lewat input | Semua `${{ }}` hanya sebagai nilai `env:`; SHA divalidasi regex 40 hex (diuji). |
| Action pihak ketiga disusupi | Workflow production **tidak memakai action sama sekali**; checkout lewat `git fetch` dari commit yang tepat. |
| SQL diganti | Lapisan: (1) checksum SHA-256 di manifest, (2) lint SQL (token terlarang, file read-only tidak boleh menulis, B tidak boleh menulis ledger, D hanya satu INSERT), (3) daftar objek yang boleh diubah (`ddl_targets`, `allowed_public_refs`) — checksum yang dibuat ulang tetap gagal jika objek baru disentuh, (4) B memeriksa sidik jari data dan objek lain sebelum/sesudah dan membatalkan seluruhnya bila ada beda, (5) CI gladi bersih membuktikan perubahan katalog = `expected_effects` persis, (6) review PR oleh Founder. Checksum saja tidak dianggap cukup. |
| SHA basi / salah | SHA input harus = commit workflow = ujung `main` saat itu; selain itu STOP. |

## Persetujuan: dibuktikan, bukan diasumsikan
GitHub membuat Environment yang belum ada secara otomatis **tanpa** reviewer. Karena itu workflow memeriksa sendiri
`GET /actions/runs/{id}/approvals`: harus ada review `approved` oleh pemilik repository untuk `production-migration`.
Jika Required reviewers belum diatur, daftar kosong dan job **STOP sebelum secret dipakai**. Kesiapan mekanisme persetujuan
baru terbukti pada run pertama (`owner-audit` atau `verify-only`) yang benar-benar meminta persetujuan Anda.

## Konfigurasi sekali (dari browser HP) — dikerjakan Founder
1. Repo → **Settings → Environments → New environment** → nama persis `production-migration`.
2. Centang **Required reviewers** → tambahkan akun Founder. Biarkan **Prevent self-review** TIDAK dicentang (satu-satunya reviewer adalah pemilik). Matikan **Allow administrators to bypass** bila tersedia.
3. **Deployment branches and tags → Selected branches and tags → main.**
4. (Disarankan) **Settings → Branches/Rulesets → main**: wajib pull request, wajib status check CI, larang force-push.
5. **Jangan** isi variable/secret sebelum langkah berikut disetujui.

## Role database — TIDAK dibuat oleh sistem ini
Tidak ada role yang dibuat dan tidak ada role berkekuatan `postgres` yang dipakai tanpa audit pemilik dan persetujuan terpisah.
1. Founder menjalankan **satu SELECT read-only** `supabase/prod-packages/tools/owner_audit_readonly.sql` di SQL Editor dan mengirim hasilnya (tanpa data pelanggan).
2. Hasil audit menentukan role: pemilik objek (`prompter_invoices`, `fn_apply_verified_payment`) menentukan apakah role migrasi bisa sempit, atau harus anggota role pemilik (= berkekuatan tinggi).
3. Role `linoe_migrator` dibuat hanya setelah persetujuan terpisah. Runner menolak login selain `linoe_migrator.<project_ref>`, menolak superuser, dan menolak anggota `postgres`/`supabase_admin` kecuali `approved_privileged_role` diubah lewat PR yang disetujui.
4. Barulah Environment diberi variable `MIGRATION_DB_HOST` (pooler `aws-N-ap-southeast-1.pooler.supabase.com`), `MIGRATION_DB_USER` (`linoe_migrator.<ref>`) dan secret `MIGRATION_DB_PASSWORD`. Port wajib 5432 (pooler mode session), TLS wajib.

## Cara menjalankan (HP)
1. GitHub → **Actions → Production Migration → Run workflow**, pilih branch **main**, paket `p0-2`, mode, dan **SHA 40 karakter ujung main** (salin dari halaman Commits).
2. Buka notifikasi **Review deployments** (aplikasi GitHub Mobile atau halaman run) → setujui.
3. Urutan yang disarankan: `owner-audit` → `verify-only` → `apply` → `verify-only`.

| Mode | Efek |
|---|---|
| `owner-audit` | Laporan pemilik/hak (read-only) |
| `verify-only` | Sesuai keadaan DB: sebelum apply → preflight A; ter-apply belum dicatat → C; selesai → F. Read-only |
| `apply` | Hanya jika keadaan = sebelum apply: A → B → C (dibandingkan dengan A) → D → F |
| `record-ledger` | Hanya jika ter-apply tapi belum dicatat: C → D → F |
| `rollback` | E (menolak sendiri bila sudah ada invoice terhubung). Catatan ledger tidak dihapus otomatis |

Hasil ada di **Summary** run. Baris terakhir `RESULT: PASS` atau `RESULT: STOP - <alasan>`.

## Prosedur STOP
- Pemeriksaan A/C/F tidak sesuai, keadaan `UNKNOWN`, atau error apa pun → job berhenti; langkah berikutnya tidak jalan. B adalah satu transaksi: kegagalan membatalkan seluruhnya.
- Jangan jalankan ulang tanpa memahami penyebab. Kirim teks Summary ke Claude.
- C gagal setelah B sukses: D tidak dijalankan. Keputusan `rollback` ada pada Founder (persetujuan terpisah).
- Hanya satu run pada satu waktu (`concurrency`).

## Mencegah migrasi lama terulang
Runner menolak jika: paket tidak ada di manifest; checksum/lint/daftar objek tidak cocok; keadaan DB bukan yang diharapkan (hash fungsi, kolom, ledger); versi sudah ada di ledger. Tidak ada jalur yang memutar ulang direktori migrasi.

## Menambah paket baru
PR yang menambah folder di `supabase/prod-packages/<id>/`, entri manifest (checksum, `ddl_targets`, `allowed_public_refs`, `expected_effects`), opsi di workflow, dan tes gladi bersih. Wajib CI hijau dan persetujuan Founder.

## Risiko tersisa
- Run pertama baru bisa diuji setelah merge (workflow_dispatch hanya muncul di branch default). Mulai dengan `owner-audit`/`verify-only`.
- Pembatasan IP Supabase tidak praktis (IP runner GitHub berubah); perlindungan = TLS + password kuat + role terbatas + persetujuan.
- Role yang harus menjadi anggota pemilik objek berkekuatan tinggi pada project bersama; dikendalikan oleh persetujuan, checksum, lint, dan sidik jari objek lain.
- `actions/checkout` tidak dipakai; runner GitHub tetap pihak ketiga yang tepercaya.
- Berkas D memakai variabel psql `:'created_by'`; untuk SQL Editor manual ganti dengan teks literal.

---
# Pipeline v2 (PR-1): perluasan runner dan gladi bersih PG17

Status: **kode + tes + dokumen saja.** PR-1 TIDAK menambah paket ke `manifest.json` (hanya `p0-2`), TIDAK menambah opsi paket di workflow, dan paket `p0-2` tidak berubah (berkas dan entri manifest identik; entri dikunci hash di tes). Paket `p0-3`, `l1-storage`, `p3-consent` menyusul di PR-2/PR-3 dan masing-masing butuh persetujuan Founder. **Workflow tidak boleh dijalankan sebelum persetujuan eksplisit.**

## Kelas bukti (jujur)
| Kelas | Arti | Isi PR-1 |
|---|---|---|
| CODE | terbaca di berkas | runner, lint, SQL probe, dokumen ini |
| UNIT | tes tanpa database | `tests/test_tools.py` (p0-2, tidak diubah), `tests/test_tools_v2.py`, tes statis TypeScript |
| SANDBOX | PostgreSQL sementara + stub storage, **bukan Supabase** | `rehearsal.sh` bagian 7 (fixture sintetis `fx-n`) |
| REAL | terbukti di produksi | **tidak ada** |
| UNKNOWN | belum terbukti | lihat daftar di bawah |

Rehearsal = **SANDBOX**. Ia membuktikan logika runner dan lint, bukan hak, kepemilikan, atau perilaku Supabase Storage nyata.

## Model hak migrasi: R1 (default) dan R2 (cadangan)
- **R1 (keputusan Founder)**: `linoe_migrator` dicoba TANPA hak istimewa. Runner **tidak pernah** menaikkan hak: tidak ada `CREATE/ALTER ROLE`, `GRANT`, atau `SET ROLE` oleh kode Python (dijaga tes). Bila probe hak `BLOCK`/`UNKNOWN`, `apply` dibatalkan **sebelum menulis apa pun**; hasilnya HOLD, bukan eskalasi.
- **R2 (cadangan, butuh persetujuan Founder)**: Founder menerapkan berkas bentuk N lewat SQL Editor Supabase; runner hanya menjalankan A/C/F (+ D bila diizinkan) dan mencetak sha256 untuk dicocokkan. Tidak dipakai kecuali Founder menyetujui secara terpisah.
- `approved_privileged_role` tetap `false` (R3 = PR terpisah, tidak disarankan).

## Allow-list per paket (bukan pelonggaran global)
Lint global TETAP menolak: `drop policy/trigger/function`, `create policy/trigger`, `delete from`, `UPDATE` tabel non-`public`, ACL (`grant/revoke`) di luar `public` atau ke `public/anon/authenticated`, `truncate` bentuk apa pun. Sebuah pernyataan hanya lolos bila cocok dengan **satu entri `allow`** di manifest paket itu: `kind` + `schema` (hanya `public` atau `storage`) + `table` + `names` literal (mis. `drop_policy`, schema `storage`, table `objects`, names eksplisit); `update_rows` wajib `columns` + `where`; `delete_from` wajib `where` dan boleh dikunci ke satu fungsi (`in_function`); `revoke/grant` wajib `objects` + `privileges` + `roles`. Rollback punya `rollback_allow` sendiri.
Tidak pernah bisa dilonggarkan oleh manifest: `ALTER ... OWNER`, `set role`/`session authorization`, `session_replication_role`, `pg_advisory*`, `COPY ... PROGRAM`, `EXECUTE` dinamis, `DROP` tanpa nama/dengan wildcard/`CASCADE`, `GRANT` keanggotaan role, `ALTER DEFAULT PRIVILEGES`, `grant/revoke ... ALL ... IN SCHEMA`, `DISABLE TRIGGER`, meta-perintah psql (`\!`, `\i`, ...), literal `E'...'`, CRLF. Entri tanpa pemakaian (usang) = galat. Tanpa `allow`, perilaku sama seperti sebelumnya (p0-2 lolos tanpa perubahan).

## Bentuk paket
- **W (wrapped, p0-2)**: B membungkus migrasi apa adanya; migrasi dilarang membawa `begin/commit`.
- **N (native-txn)**: B = berkas migrasi itu sendiri (sha256 sama), E = berkas rollback itu sendiri; wajib tepat satu `begin` di awal dan satu `commit` di akhir. Atomik: galat di mana pun membatalkan semuanya; runner mencetak `state after the failed B: PRE`.
- **S** dapat menghitung kolom `keadaan` (`PRE`/`APPLIED_UNRECORDED`/`DONE`/`ROLLED_BACK`/`UNKNOWN`, kosakata tertutup). **G** (opsional) diperiksa setelah rollback; keadaan sesudahnya wajib `PRE`/`ROLLED_BACK`. Baris ledger tidak dihapus otomatis sehingga `apply` ulang ditolak (`ROLLED_BACK`).
- `ledger_verify: true` (paket baru): setelah D, runner memeriksa baris ledger tepat satu, nama cocok, dan `statements` memuat sha256 migrasi dari manifest; nama ganda terdeteksi.
- Timeout: `lock_timeout=3000` ms ditambahkan ke semua sesi runner (sabuk), `statement_timeout` 120000 ms; paket boleh menyempit lewat `timeouts` (batas 100..10000 / 1000..120000). Berkas migrasi tetap memasang `set local` sendiri.

## Privilege probe (read-only)
Diturunkan dari `allow` (+ `probes` eksplisit): keanggotaan role pemilik (syarat `DROP/CREATE POLICY`, `DROP TRIGGER`, `COMMENT`, `ALTER TABLE`), hak `TRIGGER`/`SELECT`/`UPDATE`/`DELETE`, `CREATE` di schema, `INSERT` ledger, plus ACL mentah (md5 dan hitungan hak tulis non-pemilik). Status per probe `PASS`/`BLOCK`/`UNKNOWN`/`INFO`; label hanya urutan + jenis (mis. `tbl1.owner`), tanpa nama objek. Probe tidak menulis dan tidak mencoba `DROP`. `REVOKE` oleh non-pemilik di PostgreSQL berupa no-op diam-diam: karena itu C/F memeriksa ACL mentah (`has_*_privilege`/`aclexplode`). p0-2 tidak punya `allow`, jadi tidak menjalankan probe.

## Aturan log publik (repo PUBLIC = log publik)
Runner hanya mencetak: nama pemeriksaan, `PASS/FAIL`, hitungan, hash, dan boolean. Tidak pernah: nama policy/bucket/tabel/fungsi, baris, atau teks galat PostgreSQL mentah (yang mengutip nama objek pihak lain). Galat diringkas ke `SQLSTATE` + deskripsi tetap (+ tag penjaga paket untuk `P0001`). Nilai hasil query di luar boolean/integer/hash/timestamp = STOP. Dijaga: tes AST (runner tidak boleh menyisipkan variabel hasil mentah ke baris log), tes statis TypeScript (`string_agg` hanya di dalam `md5`), dan rehearsal yang meng-`grep` seluruh log terhadap nama "pihak lain" kanari dan password. Nama objek milik pihak lain tetap hanya dilihat lewat SQL Editor privat.

## Langkah dari HP Android (Founder)
1. Buka PR-1 di GitHub (aplikasi/browser HP), baca ringkasan dan hasil CI. Draft PR **jangan** di-merge sebelum Anda mengirim `APPROVE MERGE-PRODPKG-1` ke Claude.
2. Setelah merge: tidak ada yang berjalan otomatis. Workflow tetap manual (Actions > Production Migration > Run workflow), pilih `main`, paket `p0-2`, mode, dan SHA 40 karakter ujung `main` (salin dari halaman Commits), lalu setujui Review deployments. Jangan menjalankan sebelum Anda menyetujui eksplisit untuk run itu.
3. Untuk paket baru (PR-2/PR-3): urutan `owner-audit` (menampilkan probe) > `verify-only` > keputusan GO/HOLD bersama Claude > `apply` > `verify-only`. Probe `BLOCK` berarti HOLD (R1); R2 hanya dengan `APPROVE MANUAL-APPLY-<PAKET>`.
4. Kirim teks Summary (aman dipublikasi) ke Claude; jangan kirim password/token.

## UNKNOWN (belum terbukti; bukan dianggap aman)
Pemilik dan hak nyata `storage.*`/`prompter_audit_logs`/fungsi di produksi; perilaku Supabase Storage nyata; apakah `PGOPTIONS` (statement/lock timeout) diteruskan oleh Supavisor; kunci tepat pada tabel hidup; hasil CI PG17 untuk bagian 7 sampai job selesai; run pertama workflow di produksi (belum pernah ada).

## Dependensi
PR-2: `p0-3` + `l1-storage` (bentuk N pertama, entri `allow` nyata, tes terhadap berkas L1 asli sudah ada sebagai UNIT). PR-3: `p3-consent` (setelah #186 final). Opsi workflow baru hanya muncul setelah merge ke `main`.
