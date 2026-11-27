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

Status: **kode + tes + dokumen saja.** PR-1 TIDAK menambah paket ke `manifest.json` (hanya `p0-2`), TIDAK menambah opsi paket di workflow, dan berkas paket `p0-2` serta entri manifestnya tidak berubah (entri dikunci hash di tes). Yang berubah adalah **runner** yang menjalankan `p0-2` (lihat "Perubahan perilaku runner untuk p0-2" di bawah, ditulis apa adanya). Paket `p0-3`, `l1-storage`, `p3-consent` menyusul di PR-2/PR-3 dan masing-masing butuh persetujuan Founder. **Workflow tidak boleh dijalankan sebelum persetujuan eksplisit.**

## Kelas bukti (jujur)
| Kelas | Arti | Isi PR-1 |
|---|---|---|
| CODE | terbaca di berkas | runner, lint, SQL probe, dokumen ini |
| UNIT | tes tanpa database | `tests/test_tools.py` (p0-2, tidak diubah), `tests/test_tools_v2.py`, tes statis TypeScript |
| SANDBOX | PostgreSQL sementara + stub storage, **bukan Supabase** | `rehearsal.sh` bagian 7 dan 8 (fixture sintetis `fx-n`, termasuk semua trik QA #188) |
| REAL | terbukti di produksi | **tidak ada** |
| UNKNOWN | belum terbukti | lihat daftar di bawah |

Rehearsal = **SANDBOX**. Ia membuktikan logika runner dan lint, bukan hak, kepemilikan, atau perilaku Supabase Storage nyata.

## Model hak migrasi: R1 (default) dan R2 (cadangan)
- **R1 (keputusan Founder)**: `linoe_migrator` dicoba TANPA hak istimewa. Runner **tidak pernah** menaikkan hak: tidak ada `CREATE/ALTER ROLE`, `GRANT`, atau `SET ROLE` oleh kode Python (dijaga tes). Bila probe hak `BLOCK`/`UNKNOWN`, `apply` dibatalkan **sebelum menulis apa pun**; hasilnya HOLD, bukan eskalasi.
- **R2 (cadangan, butuh persetujuan Founder)**: Founder menerapkan berkas bentuk N lewat SQL Editor Supabase; runner hanya menjalankan A/C/F (+ D bila diizinkan) dan mencetak sha256 untuk dicocokkan. Tidak dipakai kecuali Founder menyetujui secara terpisah.
- `approved_privileged_role` tetap `false` (R3 = PR terpisah, tidak disarankan).

## Lint SQL dan Allow-list per paket: tokenizer + tolak-semua-kecuali-yang-terdaftar (v2.1)
**Mengapa diganti.** Versi pertama (v2.0) membuang komentar `/* ... */` dengan regex lalu mencocokkan pola. Itu keliru: `select '/*'; <perintah>; select '*/';` membuat lint buta terhadap `<perintah>`, padahal `psql` tetap menjalankannya. QA independen #188 membuktikan tiga akibat: meta-perintah `\!` (menjalankan perintah di mesin runner yang memegang password migrasi), `DROP POLICY` di luar allow-list, dan `COMMIT` dini yang mematahkan atomisitas. Semuanya sudah ditutup dan diuji ulang (UNIT + SANDBOX, termasuk kontrol bahwa serangannya memang nyata di `psql`).

**Cara kerja sekarang** (`tools/run_package.py`):
1. Berkas dipecah menjadi token seperti PostgreSQL/psql membacanya: `'...'` (dengan `''`), `E'...'` (escape backslash), `$tag$...$tag$`, `"..."`, `U&`, komentar `--` dan `/* */` **bersarang**. Teks yang tidak bisa dipecah (literal/komentar tidak tertutup) = ditolak.
2. Pada token: backslash di luar literal (meta-perintah psql, termasuk `\gset`, `\g`, `\i`, `\copy`), `:var`/`:'var'` (psql mengganti isinya; hanya berkas D boleh memakai `:'created_by'`), `E'...'`, `U&'...'`, `set_config`, `nextval/currval/lastval/setval`, `pg_advisory*`, `dblink*`, `pg_read_file` dan sejenisnya (termasuk fungsi bawaan berefek samping seperti `pg_promote`, `pg_stat_reset`, `txid_current`, `pg_create_restore_point`) = ditolak di mana pun, juga bila ditulis ber-kutip (`"nextval"(...)` dinormalisasi lebih dulu). Teks SQL yang memuat karakter CR (`\r`) ditolak oleh tokenizer sendiri (psql mengakhiri komentar `--` pada CR, tokenizer tidak).
3. File dipecah menjadi pernyataan tingkat atas, dan **hanya kelas pernyataan yang terdaftar yang diterima** (tolak-semua-kecuali): `SET LOCAL lock_timeout/statement_timeout`; `DO` (isinya diperiksa pernyataan demi pernyataan); `SELECT/WITH` (tanpa `INTO`, tanpa CTE yang menulis, dan **pemanggilan fungsi default-deny**: hanya fungsi bawaan murni dari daftar tetap di `PURE_FUNCS`, mis. `now`, `count`, `md5`, `coalesce`, `to_regclass`; fungsi ber-schema, fungsi tanpa schema, dan fungsi ber-kutip yang tidak ada di daftar = ditolak); `CREATE [OR REPLACE] FUNCTION public.x` (hanya `plpgsql`/`sql`, badan diperiksa); `ALTER TABLE public.x` (tambah kolom/constraint, default/not null, RLS); `CREATE [UNIQUE] INDEX` dan `CREATE TABLE` di `public`; `CREATE TEMP TABLE ... AS SELECT`; `COMMENT ON` tabel/kolom/fungsi `public`; `REVOKE/GRANT` di `public` (bukan ke `public/anon/authenticated`, tanpa `WITH GRANT OPTION`); dan kelas **bergerbang** di bawah. Pernyataan lain apa pun (`INSERT/UPDATE/DELETE` tak terdaftar, `ALTER POLICY`, `ALTER FUNCTION`, `ALTER SCHEMA`, `CREATE FUNCTION` di `storage`, `COMMENT`/`CREATE INDEX` di `storage`, `COPY`, `LOCK`, `VACUUM`, `DO` berisi DDL, `SET search_path`, dst.) = **ditolak**. Aturan yang sama berlaku di `DO` (`perform`, `x := fn()`, kondisi `if`/`for`, `raise`), di `UPDATE/INSERT` tingkat atas, dan pada `SELECT` sesudah `COMMIT`. `SET LOCAL lock_timeout` maksimal 10 detik dan `statement_timeout` maksimal 120 detik; nilai 0 (tanpa batas) atau lebih besar ditolak.
4. **Kelas bergerbang** wajib cocok persis dengan **satu entri `allow`** di manifest paket (kind + schema + objek + nama literal): `drop_policy`, `create_policy`, `drop_trigger`, `create_trigger` (+ `functions`), `drop_function` (cocokkan **signature** `nama(tipe,tipe)`, bukan nama saja), `update_rows` (`columns` + `WHERE` wajib, tabel ber-schema, tanpa `where true`/`1=1`, daftar `SET` diurai dengan hitungan kurung sehingga subquery tidak menyembunyikan kolom), `insert_rows` (daftar kolom eksplisit), `delete_from` (`WHERE` wajib, boleh dikunci ke satu fungsi), `revoke`/`grant` (objects + privileges + roles). Berlaku juga untuk `UPDATE`/`INSERT` ke tabel `public` yang dijalankan saat apply; hanya badan fungsi yang sekadar didefinisikan boleh memuat DML ke `public`. Rollback punya `rollback_allow` sendiri; `rollback_allowed_statements` dicocokkan sebagai kesamaan pernyataan (bukan substitusi teks). Entri yang tak dipakai (usang) = galat.
5. Nama diseragamkan sebelum dicek: `public."x"`, `"public"."x"`, `public . x`, `storage."fn"()` dianggap sama dengan bentuk polos pada penjaga produk lain (publoe/mitapeng/umkmpro), `public_refs`, `foreign_refs`, `ddl_targets`, dan allow-list. Nama schema/tabel ber-kutip yang bukan huruf kecil polos ditolak.
6. Transaksi: bentuk W (migrasi/rollback mentah) **tanpa** `begin/commit/rollback/savepoint/end/abort`. Berkas yang membawa transaksi sendiri (B dan E di semua bentuk, D, dan berkas bentuk N): tepat satu `begin` di awal dan satu `commit`; setelah `commit` hanya `SELECT` (tulis setelah commit = di luar transaksi atomik = ditolak).
7. Jaring kedua: pola `FORBIDDEN` lama (`owner\s+to`, `session_replication_role`, `pg_(try_)?advisory`, `EXECUTE` dinamis, "role membership grant", `ALTER DEFAULT PRIVILEGES`, `COPY ... PROGRAM`, ...) dijalankan pada teks token yang sudah diseragamkan, untuk setiap pernyataan yang tidak lolos lewat entri allow-list.
8. Berkas A/C/F/S/G dan semua probe dijalankan di transaksi read-only dari sisi server (`default_transaction_read_only=on`): lapisan kedua di luar lint.

**Batas yang diakui (bukan klaim "pasti aman").** Lint ini adalah penjaga statis, bukan bukti. Pemanggilan fungsi kini default-deny (hanya fungsi bawaan murni dari daftar tetap yang boleh dipanggil), tetapi ini **belum menutup penuh** eksekusi kode pengguna yang terjadi tanpa menulis nama fungsi: operator buatan pengguna, cast/domain, view atau policy RLS yang memanggil fungsi, rule, dan trigger pada tabel yang ditulis. Pada `UPDATE/INSERT/DELETE` yang terdaftar di `allow`, isi ekspresi hanya dibatasi oleh pemeriksaan pemanggilan fungsi yang sama dan oleh entri allow-nya. Lint juga tidak membuktikan bahwa sebuah `WHERE` bukan tautologi yang ditulis dengan cara lain (`id=id`, `id like '%'`), dan tidak membatasi isi policy. Penutupnya: transaksi read-only untuk A/C/F/S/G, `ddl_targets`/`public_refs`/`foreign_refs` yang dikunci di manifest, review PR oleh Founder, dan rehearsal SANDBOX. Aturan yang ditolak kode lint berlaku untuk semua paket; mengubahnya = mengubah `run_package.py` lewat PR yang Anda setujui (manifest paket tidak bisa melonggarkannya). Tanpa `allow`, kelas bergerbang ditolak seluruhnya.

**Penegakan nama produk lain.** Identifier mana pun (juga ber-kutip) yang memuat `publoe`, `mitapeng`, `umkmpro`, `kagura`, atau `apotek`, serta literal string yang memuat nama-nama itu (kecuali penyebutan nama proyek bersama `umkmpro-ai` dalam pesan), ditolak. Ini pencocokan teks, bukan bukti: nama yang disamarkan atau dibentuk dinamis tidak tertangkap oleh lint dan hanya oleh review.

**Keputusan Founder (P3-5, dicatat apa adanya).** Nama objek LINOE di berkas migrasi di repo publik **boleh**. Yang **tidak boleh** muncul: nama objek produk lain, data pelanggan, credential/secret, identitas tenant, konfigurasi sensitif produksi, definisi policy produksi, dan rincian privilege sensitif. Log Actions hanya memuat hasil tersanitasi. Visibility repo tidak berubah. Sisa residual yang diterima dan didokumentasikan: tautologi `WHERE` selain `true`/`1=1`, `SELECT` dari tabel tak ber-schema/katalog, dan isi policy yang tidak dibatasi.

## Perubahan perilaku runner untuk p0-2 (apa adanya)
Berkas `p0-2` dan entri manifest tidak berubah, tetapi **runner yang menjalankannya berubah**. Daftar lengkap:
| Perubahan | Dampak pada p0-2 |
|---|---|
| `lock_timeout=3000` ms, `statement_timeout=120000` ms, `idle_in_transaction_session_timeout=60000` ms dipasang di setiap sesi runner (`PGOPTIONS`) | B p0-2 sudah memasang `set local lock_timeout='3s'` sendiri; tambahan ini sabuk. Apakah Supavisor meneruskan `PGOPTIONS` = **UNKNOWN** |
| Tata bahasa log-aman: nilai hasil query hanya boolean, bilangan bulat (sampai 19 digit), md5/sha-256 hex, timestamp; nilai lain = STOP | Kolom A/C/F p0-2 diuji terhadap nilai realistis (bigint terbesar, timestamp berpecahan detik); nilai di luar tata bahasa menghentikan run (aman, tetapi bisa mengejutkan) |
| Lint lebih ketat (tokenizer + tolak-semua-kecuali-terdaftar, `set_config` ditolak, UPDATE/INSERT `public` saat apply butuh entri) | p0-2 tetap lolos (diuji: `check-only` dan verifikasi paket bersih). Edit p0-2 di masa depan harus muat dalam kelas yang diterima |
| Galat PostgreSQL diredaksi: hanya `SQLSTATE` + deskripsi tetap (+ tag penjaga) | Teks galat asli tidak lagi tampil di log; diagnosis detail dilakukan lewat SQL Editor privat |
| Keluaran `owner-audit` difilter (hanya boolean/angka/nama role bawaan yang dikenal) | Nama role lain ditampilkan sebagai `<withheld>` |
| Baris `PASS B apply (N result columns)` hanya mencetak jumlah kolom | Dulu hasil akhir B dicetak; sekarang tidak ada nilai dari B yang masuk log |
| Probe hak dijalankan juga untuk p0-2, diturunkan dari **pernyataan** migrasi/rollback: kepemilikan `prompter_invoices`, kepemilikan fungsi `fn_apply_verified_payment` yang akan diganti, `CREATE` di schema `public` | Role yang bukan pemilik kini ditolak **sebelum** B (HOLD, R1), bukan gagal di dalam B. Role `postgres`/pemilik lolos |
| A/C/F/S/G dijalankan di transaksi read-only server | Berkas read-only itu tidak berubah; menulis di dalamnya kini juga ditolak server |
| Hasil kosong atau tanpa satu pun kolom `_harus_*` pada A/C/F = **GAGAL** (dulu bisa lolos kosong) | p0-2 punya kolom `_harus_*` di A/C/F, jadi tidak terpengaruh |
| Pesan "B atomik" hanya dicetak bila keadaan sesudah B gagal adalah `PRE`; selain itu `STATE TIDAK PRE: periksa manual` | Hanya mengubah teks laporan |
| Cek ledger ganda (versi/nama) sebelum D untuk paket ber-`ledger_verify` | p0-2 tidak memakai `ledger_verify`, jadi tidak ada cek ini |
| `verify-only` dan `owner-audit` p0-2 dengan role tanpa hak: bila probe hak = `BLOCK`, runner **berhenti dengan exit 1 (STOP)** sebelum menjalankan A/C/F | Dulu tetap berjalan sampai galat SQL; sekarang berhenti lebih awal dan jelas (R1: tidak ada kenaikan hak otomatis) |
| Probe tidak lagi mencetak md5/hitungan ACL (`acl_*`, `aclw_*`) | Nilai itu bisa menjadi sidik hak akses objek; yang dicetak tinggal `PASS/BLOCK/UNKNOWN` per pemeriksaan dan dua nilai role (boolean/hitungan) |

## Bentuk paket
- **W (wrapped, p0-2)**: B membungkus migrasi apa adanya; migrasi dilarang membawa `begin/commit`.
- **N (native-txn)**: B = berkas migrasi itu sendiri (sha256 sama), E = berkas rollback itu sendiri; tepat satu `begin` di awal dan satu `commit` di akhir. Galat di mana pun membatalkan semuanya. Setelah B gagal runner membaca keadaan: bila `PRE` ia mencetak bahwa B transaksi tunggal dan database seperti semula; selain itu ia mencetak `STATE TIDAK PRE: periksa manual` dan berhenti.
- **S** dapat menghitung kolom `keadaan` (`PRE`/`APPLIED_UNRECORDED`/`DONE`/`ROLLED_BACK`/`UNKNOWN`, kosakata tertutup). **G** (opsional) diperiksa setelah rollback; keadaan sesudahnya wajib `PRE`/`ROLLED_BACK`. Baris ledger tidak dihapus otomatis sehingga `apply` ulang ditolak (`ROLLED_BACK`); lihat "Setelah rollback".
- `ledger_verify: true` (paket baru): sebelum B dan lagi sebelum D, runner memastikan **versi dan nama** belum ada di ledger (nama ganda membuat `on conflict do nothing` pada D diam-diam tidak mencatat apa pun); setelah D ia memeriksa baris tepat satu, nama cocok, dan `statements` memuat sha256 migrasi dari manifest.
- Timeout: lihat tabel di atas; paket boleh menyempit lewat `timeouts` (batas 100..10000 / 1000..120000). Berkas migrasi tetap memasang `set local` sendiri.

## Privilege probe (read-only)
Diturunkan dari `allow` **dan dari pernyataan migrasi/rollback itu sendiri**: kepemilikan tabel yang diubah (`ALTER TABLE`, `CREATE INDEX`, `COMMENT`, `REVOKE/GRANT`, policy, trigger), hak `TRIGGER`/`SELECT`/`UPDATE`/`DELETE`/`INSERT` untuk DML bergerbang, kepemilikan fungsi yang di-`DROP` (harus ada) atau di-`CREATE OR REPLACE` (bila sudah ada), `CREATE` di schema, `INSERT` ledger, plus ACL mentah (md5 dan hitungan hak tulis non-pemilik). Objek yang dibuat oleh paket itu sendiri tidak diprobe. Rollback ikut diprobe. **Cek kepemilikan memakai `pg_has_role(..., 'USAGE')`** (hak pemilik benar-benar diwarisi), bukan `MEMBER`: role `NOINHERIT` yang hanya anggota role pemilik kini `BLOCK` (diuji di SANDBOX; dengan `MEMBER` ia lolos palsu). Status per probe `PASS`/`BLOCK`/`UNKNOWN`/`INFO`; label hanya urutan + jenis (mis. `tbl1.owner`), tanpa nama objek. Probe tidak menulis dan tidak mencoba `DROP`. `REVOKE` oleh non-pemilik di PostgreSQL berupa no-op diam-diam: karena itu C/F memeriksa ACL mentah (`has_*_privilege`/`aclexplode`).

## Aturan log publik (repo PUBLIC = log publik)
Runner hanya mencetak: nama pemeriksaan, `PASS/FAIL`, hitungan, hash, dan boolean. Tidak pernah: nama policy/bucket/tabel/fungsi, baris, atau teks galat PostgreSQL mentah (yang mengutip nama objek pihak lain). Galat diringkas ke `SQLSTATE` + deskripsi tetap (+ tag penjaga paket untuk `P0001`). Nilai hasil query di luar boolean/integer/hash/timestamp = STOP. Dijaga: tes AST (runner tidak boleh menyisipkan variabel hasil mentah ke baris log), tes statis TypeScript (`string_agg` hanya di dalam `md5`), dan rehearsal yang meng-`grep` seluruh log terhadap nama "pihak lain" kanari dan password. Catatan: **nama objek yang ada di berkas paket/allow-list (mis. nama policy L1) tampil di repo publik**; itu keputusan yang perlu Anda ketahui. Yang tidak boleh tampil di log hanyalah nama objek milik pihak lain yang dibaca dari database.

## Tabel baris log: artinya dan tindakan
Istilah: **preflight (A)** = pemeriksaan sebelum menulis; **probe** = tes hak yang hanya membaca; **ledger** = tabel catatan migrasi Supabase; **lint** = pemeriksaan teks SQL tanpa database; **state** = keadaan database menurut berkas S; **SQLSTATE** = kode lima karakter standar PostgreSQL untuk jenis galat.
| Baris log | Artinya | Tindakan Anda |
|---|---|---|
| `PASS static: package ...` | Berkas, checksum, lint, dan daftar objek paket cocok | Tidak ada |
| `FAIL static: ...` | Paket ditolak sebelum menyentuh database (checksum, lint, atau daftar objek tidak cocok) | Jangan lanjut. Kirim Summary ke Claude |
| `FAIL connection: ...` | Koneksi tidak memenuhi aturan keamanan (host, port, role) | Jangan ubah secret sendiri. Kirim Summary ke Claude |
| `state: PRE` | Belum diterapkan | Normal sebelum `apply` |
| `state: APPLIED_UNRECORDED` | Sudah diterapkan tetapi belum dicatat di ledger | Jalankan mode `record-ledger` setelah GO Claude |
| `state: DONE` | Sudah diterapkan dan dicatat | Tidak ada; `apply` akan ditolak |
| `state: ROLLED_BACK` | Pernah diterapkan lalu di-rollback; baris ledger masih ada | Lihat "Setelah rollback: cara pulih" |
| `state: UNKNOWN` | Keadaan tidak cocok dengan yang dikenal (ada yang berubah) | Semua mode berhenti. Kirim Summary ke Claude; jangan coba apa pun |
| `PASS A preflight (N columns)` / `FAIL A preflight` | Pemeriksaan sebelum menulis lolos / gagal (gagal juga bila hasil kosong) | Gagal = tidak ada yang ditulis; kirim Summary |
| `probe ...: PASS` / `BLOCK` / `UNKNOWN` | Hak ada / tidak ada / tidak bisa dinilai | `BLOCK`/`UNKNOWN` = HOLD (R1): tidak ada yang ditulis, tidak ada kenaikan hak. Kirim Summary |
| `FAIL ledger pre-check` | Versi atau nama migrasi sudah ada di ledger | Tidak ada yang ditulis. Kirim Summary |
| `PASS B apply` | Migrasi diterapkan (satu transaksi) | Lanjut otomatis ke C |
| `state after the failed B: PRE` | B gagal dan database seperti semula | Tidak ada yang rusak; kirim Summary |
| `STATE TIDAK PRE: periksa manual` | B gagal tetapi keadaan sesudahnya bukan PRE | **Berhenti.** Jangan jalankan apa pun lagi; kirim Summary |
| `PASS C ...` / `PASS D ledger recorded` / `PASS ledger row` / `PASS F final verification` | Verifikasi hasil, pencatatan ledger, dan verifikasi akhir lolos | Tidak ada |
| `RESULT: PASS` | Seluruh langkah mode itu lolos | Kirim Summary ke Claude |
| `RESULT: STOP - ...` | Ada yang tidak cocok; langkah berikutnya tidak dijalankan, tidak ada rollback otomatis | Kirim Summary ke Claude; keputusan rollback ada pada Anda |
| `SQLSTATE 42501` | Hak kurang | HOLD (R1); tidak dinaikkan otomatis |
| `SQLSTATE 55P03` | Tabel sedang dikunci proses lain (lock timeout) | Tidak ada efek; ulangi nanti atas persetujuan |
| `SQLSTATE P0001 [TAG]` | Penjaga di dalam SQL menolak (mis. kondisi pihak lain terdeteksi) | Tidak ada efek; kirim Summary |

## Setelah rollback: cara pulih
Mode `rollback` menjalankan E lalu G; bila lolos, `state: ROLLED_BACK`. **Baris ledger sengaja tidak dihapus**: ia mengunci `apply` ulang agar migrasi yang sudah ditarik tidak terpasang lagi tanpa disengaja. Pilihan Anda:
1. **Biarkan** (paling aman, tidak ada yang harus dilakukan): database kembali ke keadaan sebelum paket; ledger mencatat bahwa versi itu pernah ada.
2. **Terapkan lagi paket yang sama** (hanya atas keputusan Anda): dari HP buka Supabase > SQL Editor (browser) dan jalankan satu baris `delete from supabase_migrations.schema_migrations where version = '<VERSI DI MANIFEST>';` (ganti `<VERSI DI MANIFEST>` dengan 14 digit versi paket; salin dari `manifest.json`). Lalu Actions > Production Migration > `verify-only`: harus `state: PRE`. Setelah itu urutan normal (`apply`). Runner **tidak pernah** menjalankan `delete` ini. Kelas bukti: urutan "hapus baris ledger lalu `verify-only` = PRE" terbukti di **SANDBOX**; di Supabase nyata **UNKNOWN**.
3. **Terapkan versi yang diperbaiki**: PR baru dengan versi/nama migrasi baru (berkas baru, entri manifest baru); baris ledger lama tetap sebagai riwayat.
Jangan menghapus baris ledger bila `state` bukan `ROLLED_BACK` (mis. `DONE`): itu membuat catatan tidak jujur.

## Langkah dari HP Android (Founder)
1. Buka PR-1 di GitHub (aplikasi/browser HP), baca ringkasan dan hasil CI. Draft PR **jangan** di-merge sebelum Anda mengirim `APPROVE MERGE-PRODPKG-1` ke Claude.
2. Setelah merge: tidak ada yang berjalan otomatis. Workflow tetap manual (Actions > Production Migration > Run workflow), pilih `main`, paket `p0-2`, mode, dan SHA 40 karakter ujung `main` (salin dari halaman Commits), lalu setujui Review deployments. Jangan menjalankan sebelum Anda menyetujui eksplisit untuk run itu.
3. Untuk paket baru (PR-2/PR-3): urutan `owner-audit` (menampilkan probe) > `verify-only` > keputusan GO/HOLD bersama Claude > `apply` > `verify-only`. Probe `BLOCK` berarti HOLD (R1); R2 hanya dengan `APPROVE MANUAL-APPLY-<PAKET>`.
4. Kirim teks Summary (aman dipublikasi) ke Claude; jangan kirim password/token.

## UNKNOWN (belum terbukti; bukan dianggap aman)
Pemilik dan hak nyata `storage.*`/`prompter_audit_logs`/fungsi di produksi; perilaku Supabase Storage nyata; apakah `PGOPTIONS` (statement/lock timeout dan `default_transaction_read_only`) diteruskan oleh Supavisor (bila tidak, A/C/F tetap dilindungi lint, tetapi lapisan read-only server tidak berlaku); kunci tepat pada tabel hidup; apakah `pg_has_role(..., 'USAGE')` pada role Supabase nyata memberi hasil yang sama dengan SANDBOX; run pertama workflow di produksi (belum pernah ada); jalur "hapus baris ledger" di Supabase nyata.

## Dependensi
PR-2: `p0-3` + `l1-storage` (bentuk N pertama, entri `allow` nyata, tes terhadap berkas L1 asli sudah ada sebagai UNIT). PR-3: `p3-consent` (setelah #186 final). Opsi workflow baru hanya muncul setelah merge ke `main`.
