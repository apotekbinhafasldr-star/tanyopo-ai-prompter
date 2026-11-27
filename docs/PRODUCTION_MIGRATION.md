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

## Model ancaman dan lapisan pengendali (PR-1)
**Aset** (urut nilai): (1) identitas `linoe_migrator` pada database Supabase **bersama** (PUBLOE, MITAPENG, UMKMpro, LINOE); (2) data dan skema produk lain; (3) integritas dan ketersediaan produksi LINOE; (4) gerbang persetujuan Environment.
**Penyerang**: T1 penulis PR ceroboh (termasuk SQL buatan AI), yang paling mungkin; T2 penulis PR jahat atau akun terkompromi yang bisa mengubah paket **dan** runner/lint dalam satu PR; T3 fork/PR luar (tidak punya secret; workflow hanya `workflow_dispatch` dengan Environment); T4 rantai pasok paket/image runner; T5 pembaca log publik.
**Pernyataan jujur**: lint teks (`tools/run_package.py`, tokenizer + default-deny) adalah **tripwire terhadap kecerobohan (T1)**, bukan batas keamanan. Penulis PR jahat (T2) dapat mengubah lint di PR yang sama; yang menahannya adalah review Founder, hak role, dan persetujuan Environment atas SHA yang sudah di-merge. **Tokenizer dibekukan**: tidak ada kata/token terlarang baru; ia hanya diubah bila ada temuan P0/P1. Kekuatan yang bertambah datang dari kontrol di sisi **server**, bukan dari daftar kata.

**Kontrol struktural yang berjalan sekarang** (semua dibuktikan pada PostgreSQL nyata di rehearsal, kelas SANDBOX; `tests/rehearsal_structural.py`):
1. **`search_path = pg_catalog, pg_temp` di sesi yang sama** (item `-c` pertama sebelum SQL paket). Nama tanpa schema hanya bisa menjadi objek `pg_catalog`: fungsi bernama kata kunci (`first(1)`, `set(1)`), notasi atribut `t.fn`, dan bayangan overload (`md5(1)` -> `public.md5(int)`, termasuk `substring`, `overlay`, `format`, `left`, `replace`, `version`) tidak ter-resolve. Terbukti: dengan sesi biasa keempat jalur itu menjalankan fungsi pengguna, dengan sesi runner tidak satu pun. **Tidak menutup**: panggilan ber-schema (`public.md5(1)` tetap jalan; dideteksi lint dan, saat apply, oleh pemeriksaan efek) dan `SET search_path` oleh SQL paket (GUC itu USERSET; lint menolak `SET` selain timeout, jadi ini tetap bergantung pada tripwire + review).
2. **SQL dikirim dengan `psql -c`, tidak pernah `-f`**: psql tidak menafsir meta-command (`\!`, `\gexec`) maupun `:variabel` pada teks `-c` (terbukti, termasuk `\!` sesudah CR di komentar). Variabel `:'created_by'`, `:'ver'`, dsb. diganti oleh runner menjadi literal ber-kutip dari nilai yang divalidasi; bentuk `:x`, `:"x"`, `:{?x}` ditolak. Timeout (`statement_timeout`, `lock_timeout`) juga diset di dalam sesi, tidak hanya lewat `PGOPTIONS`.
3. **Fase check (A/C/F/S/G, probe, cek ledger, owner-audit) = `BEGIN READ ONLY` + satu query (snapshot) + `ROLLBACK`.** Sesudah snapshot, `SET TRANSACTION READ WRITE` ditolak server (terbukti); `default_transaction_read_only` saja bisa dibalik oleh satu `SET`. **Batas**: server menolak `SET TRANSACTION READ WRITE`, `SET LOCAL transaction_read_only=off`, `SAVEPOINT`, `COMMIT AND CHAIN`, `PREPARE TRANSACTION`, dan `SET ROLE` di dalam transaksi itu, tetapi `commit; begin read write; insert ...` **dijalankan dan menulis** (QA mereproduksinya). Penutupnya hanya lint (menolak COMMIT/BEGIN/END/ABORT), jadi READ ONLY **tidak independen dari lint**: klaim "menulis ditolak server" benar hanya untuk SQL yang lolos lint. **Berkas tulis (B, E, D) tidak read-only**: untuk mereka penutupnya adalah poin 4, review PR, dan rehearsal.
4. **Fase apply (B, E, D): runner memecah berkas di satu-satunya `COMMIT`-nya dan, sebelum `COMMIT`, meminta server membuktikan apa yang dilakukan transaksi**: (a) `txid_current()` sama dengan di awal (tidak ada `COMMIT` dini); (b) setiap tabel dengan tuple ditulis di `pg_stat_xact_all_tables` harus ada di daftar paket (target `rows:`/`table:` dari lint + `allow`; ledger untuk D); (c) fakta katalog global tidak berubah (role, keanggotaan, schema, ekstensi, event trigger, publikasi, server foreign, bahasa, cast/operator/tipe buatan, objek di schema selain `public`/`storage`); (d) objek yang ditambah/dihapus di `public`/`storage` (relasi, fungsi, policy, trigger) harus dinyatakan paket. Pelanggaran = `RAISE` -> koneksi berhenti -> **ROLLBACK**; log hanya memuat SQLSTATE dan tag tetap `EFEK DI LUAR DAFTAR` (plus nama kategori katalog, tanpa nama objek). Terbukti: tulis ke tabel lain (termasuk lewat fungsi), fungsi/schema/operator tak dinyatakan, dan berkas dengan `COMMIT` dini/ganda atau tanpa `BEGIN` ditolak.
   **Batas jujur pemeriksaan efek (daftar lengkap yang diketahui, per bukti QA #188)**. Yang **tertangkap** hanya: INSERT/UPDATE/DELETE (tuple) ke tabel di luar daftar, langsung maupun lewat fungsi definer; `DROP TABLE`; `CREATE TABLE`/objek baru; fungsi/policy/trigger/schema/operator/role baru atau dihapus di luar daftar. Yang **lolos dan ter-COMMIT** (terbukti lewat fungsi `SECURITY DEFINER` sintetis ber-EXECUTE PUBLIC pada tabel di luar daftar): `ALTER POLICY ... USING` (isi policy berubah, nama sama), `ALTER TABLE ... DISABLE/NO FORCE ROW LEVEL SECURITY`, `ALTER TABLE ... SET (fillfactor)`, `ADD COLUMN ... DEFAULT` (menulis ulang tabel), `DROP COLUMN`, `COMMENT ON`, `pg_notify`, `TRUNCATE` (baris hilang, tanpa tuple tercatat), `nextval` (sekuens), `GRANT ... TO PUBLIC` dan perubahan ACL lain, `CREATE OR REPLACE FUNCTION` bernama sama (isi diganti), kunci advisory, panggilan luar (`dblink`, ekstensi), dan pembacaan data (kerahasiaan). Jadi **perubahan policy/RLS/kolom pada tabel produk lain TIDAK tertangkap oleh pemeriksaan efek**; yang menutupnya hanyalah lint (kelas pernyataan default-deny), review, dan hak role. Pemeriksaan katalog tambahan (snapshot `pg_policy`/`pg_attribute`/`relrowsecurity`/`relacl` sebelum vs sesudah) **tidak ditambahkan di PR-1**: harus dibandingkan per tabel yang dinyatakan (p0-2 sah mengubah policy dan kolom tabelnya sendiri), sehingga butuh parser/manifest v2 (PR-2); ia dicatat sebagai batas, bukan klaim. Daftar tabel tertulis adalah himpunan yang **dinyatakan**, bukan baris per baris. Butuh `track_counts=on` (diperiksa; bila mati, STOP). Perubahan katalog oleh sesi lain pada jendela yang sama dapat memberi STOP palsu (aman: rollback, ulangi). Perilaku untuk tabel partisi dan schema `storage`/`auth` produksi: UNKNOWN.
5. **Deteksi pemanggilan ber-schema** (`x.y(`, `OPERATOR(x.y)`, `::x.y`) dipertahankan di lint; C2 (DML) dan C4 (ekspresi DDL) tetap tertutup dengan tes regresi. `CREATE FUNCTION` bernama sama dengan fungsi bawaan ditolak.
6. **Pemisahan alat dan paket**: CI (`prod-pipeline-separation`, hanya pada PR) gagal bila satu PR mengubah sisi alat (`supabase/prod-packages/tools/`, `production-migration.yml`, `manifest.json`, `CODEOWNERS`) **dan** berkas paket (`supabase/prod-packages/<paket>/`, `supabase/migrations/`, `supabase/rollback/`). Akibatnya paket baru dan entri manifest-nya masuk lewat dua PR terpisah. Sisi alat kini juga mencakup `.github/workflows/ci.yml` (tempat job pemisahan berada) dan `.gitattributes`. `.github/CODEOWNERS` **meminta** review pemilik repo untuk jalur itu. **Keadaan pengaturan repo saat ini (dibaca QA lewat REST, tidak diubah di sini)**: ruleset `LINOE - Protect Main` memiliki `required_approving_review_count=0`, `require_code_owner_review=false`, dan required check hanya `build`. Artinya review **tidak wajib**, dan `prod-pipeline-separation` serta `prod-migration-rehearsal` **tidak memblokir merge**. Review dan approval saat ini ditegakkan oleh **proses Founder (membaca diff) + approval Environment manual**, bukan oleh ruleset. **Keputusan Founder (belum diterapkan, tidak diubah oleh PR ini)**: set approving review >= 1, aktifkan code owner review, dan jadikan `prod-pipeline-separation` serta `prod-migration-rehearsal` required check.

**Apa yang dibuktikan dan tidak dibuktikan** (kelas bukti: SANDBOX/UNIT; **tidak ada** klaim REAL):
| Klaim | Status | Dasar |
|---|---|---|
| Nama tak ber-schema tidak bisa memanggil fungsi pengguna di sesi runner | Dibuktikan pada PG 16 lokal dan PG 17 CI untuk korpus yang diuji | `rehearsal_structural.py`, `fuzz_oracle.py` |
| Panggilan ber-schema ke fungsi pengguna | **Tidak ditutup oleh search_path**; ditolak lint, ditangkap pemeriksaan efek bila menulis tabel | uji "documented limit" + efek |
| Tulis ke tabel di luar daftar saat apply dibatalkan | Dibuktikan **hanya untuk tuple** (INSERT/UPDATE/DELETE langsung atau lewat fungsi), `DROP TABLE`, dan objek baru. **Tidak** untuk DDL definisi/RLS/policy/kolom, `COMMENT`, `TRUNCATE`, ACL, `pg_notify` (lihat daftar di poin 4) | `rehearsal_structural.py` |
| Tidak ada efek non-transaksional (sekuens, advisory, jaringan, `NOTIFY` di luar transaksi) | **Tidak dibuktikan** | batas di poin 4 |
| Role hak minimum membatasi tulis ke tabel produk lain secara langsung | Dibuktikan (role sintetis `fz_min`: `permission denied`) | `rehearsal_structural.py` |
| Role hak minimum menutup fungsi `SECURITY DEFINER` produk lain | **Tidak dibuktikan; terbukti sebaliknya**: fungsi definer dengan `EXECUTE` PUBLIC bawaan **menulis** untuk `fz_min`. Hanya pemilik fungsi yang mencabut PUBLIC yang menutupnya (terbukti pada `fn_closed`) | `rehearsal_structural.py` |
| Pemanggilan fungsi definer itu tanpa schema | Tidak ter-resolve di sesi runner (terbukti); **dengan schema** tetap jalan di tingkat hak, tetapi dibatalkan pemeriksaan efek bila menulis tabel di luar daftar (terbukti). Efek non-tabel tidak tercakup | `rehearsal_structural.py` |
| Parser/allow-list struktural (AST) | **Tidak dibangun di PR-1**; yang ada adalah allow-list token pada tokenizer beku (tripwire) | bagian "Ditunda ke PR-2" |
| Manifest: checksum per berkas, entri spesifik tanpa wildcard | Dibuktikan oleh uji unit (ubah satu byte, entri wildcard, path berbeda: ditolak). Checksum **hanya** mencegah pertukaran berkas; penulis PR yang menghitung ulang hash lolos, sehingga yang menahannya adalah review dan persetujuan | `test_tools_v2.py` |
| Kerahasiaan (`select` dari `auth`/`vault`, kebocoran 1-bit lewat log) | **Tidak dibuktikan**; hanya hak role yang menjaganya | residual P3-5 |
| Lint menolak semua SQL berbahaya | **Tidak diklaim**; tripwire | T2 |
| Fuzz | Bukti keberadaan, bukan ketiadaan celah; lihat bagian berikut | `fuzz_oracle.py` |
| Supabase nyata (Supavisor, hak role, pemilik objek, fungsi definer PUBLIC produk lain, `track_counts`, versi mayor) | **UNKNOWN** | belum ada akses/audit |

**Fuzz diferensial dengan PostgreSQL sebagai oracle** (`tests/fuzz_oracle.py`, seed tetap `20261127`, dijalankan di rehearsal CI). Fungsi pengguna "umpan" (3 tanda tangan) dibuat untuk **setiap** kata non-reserved/type_func PostgreSQL dan beberapa nama bawaan; tiap pernyataan yang **diterima lint** dijalankan di sesi biasa (kontrol) dan di sesi runner; yang dihitung adalah pernyataan yang benar-benar memanggil fungsi umpan. Lari lokal (PG 16, seed 20261127, 20.000 komposisi acak + produk penuh nama x bentuk): korpus 31.861 pernyataan, ditolak lint 29.814, diterima 2.047; di sesi biasa 1.686 di antaranya memanggil fungsi umpan (artinya lint saja **bukan** batas), di sesi runner **0**. CI (PG 17) mencetak hitungan lari sendiri. Batas fuzz: satu seed dan korpus buatan kami, satu versi server per lari, tidak mencakup panggilan ber-schema (ditolak lint), operator/cast/view, dan tidak membuktikan ketiadaan bypass lain. Bentuk yang pernah lolos dan sudah ditutup ada sebagai tes regresi tetap (QA 07/09/10).

**Rehearsal**: sebelum perubahan ini 115 baris `PASS:` (angka "116" yang sempat disebut menghitung juga baris `ALL PASSED`, yang bukan tes). Sesudahnya lari lokal PG 16: 148 baris `PASS:` (115 lama, termasuk p0-2 penuh dan fixture `fx-n` di bawah `search_path = pg_catalog`, `-c`, dan pemeriksaan efek; ditambah 32 uji struktural dan 1 fuzz), 0 `FAIL`. Log CI PG 17 memuat angkanya sendiri.

**Ditunda ke PR-2 (rencana, tidak diimplementasikan sekarang)**: parser AST asli + allow-list AST per paket (menunggu keputusan lisensi Founder: pglast GPL-3.0+ atau libpg_query BSD; job lint terpisah tanpa secret, versi dan hash dipin, job produksi tetap stdlib-only); role `linoe_owner` NOLOGIN dan `linoe_migrator` NOINHERIT dengan `SET ROLE` oleh runner; audit fungsi definer PUBLIC milik produk lain (hanya hitungan, ke Founder); manifest versi 2 (relasi baca/tulis, kolom, fungsi yang boleh dipanggil, efek yang diharapkan). Tidak ada dependensi pip/npm baru di job produksi pada PR-1.

## Evaluasi arsitektur alternatif dan rekomendasi final
Pertanyaan: apakah "paket terverifikasi dengan checksum terkunci + manifest spesifik + review independen + persetujuan Environment manual" sudah cukup untuk PR-1, dengan lint/server-side sebagai lapisan tambahan dan pendekatan struktural lain ditunda?

| | A. Checksum + manifest + review + approval | B. A + lapisan server-side (search_path, READ ONLY, efek sebelum COMMIT, lint tripwire) | C. Struktural penuh (A + B + parser AST allow-list, role owner/migrator, `SET ROLE`, manifest v2) |
|---|---|---|---|
| Kompleksitas | Rendah (sudah ada: sha256 per berkas, entri spesifik, `workflow_dispatch` + Environment) | Sedang (runner lebih besar; semua stdlib, tanpa dependensi baru) | Tinggi (parser pihak ketiga, lisensi, pemisahan role, skema manifest baru) |
| Keamanan yang dibuktikan | Mencegah pertukaran berkas setelah review. **Tidak** menahan penulis PR jahat yang mengubah berkas dan hash bersama; yang menahan adalah reviewer manusia | A + terbukti pada PG nyata: bayangan fungsi tak ber-schema tertutup, check read-only, tulis tabel di luar daftar dibatalkan. Batas dicatat di tabel "dibuktikan/tidak" di atas | Belum ada bukti; belum dibangun |
| Beban Founder dari HP | Terendah: baca diff + satu tombol approve | Sama dengan A (kontrol berjalan otomatis; log publik tanpa nama) | Tertinggi: keputusan lisensi, role di Supabase (dashboard, bukan HP-ramah), review skema manifest |
| Risiko | Review manusia adalah satu-satunya penahan SQL berbahaya; kelalaian reviewer langsung tembus | Rasa aman palsu bila lapisan dianggap batas; false STOP pada perubahan katalog bersamaan; klaim berlebih bila docs tidak jujur | Jadwal PR-1 tertunda; risiko salah konfigurasi role di database bersama; perubahan hak = R2 (butuh persetujuan Founder) |

**Cakupan checksum**: manifest mengunci sha256 berkas **paket** (A/B/C/D/E/F/G/S, migrasi, rollback); runner menolak sebelum koneksi bila satu byte berubah (terbukti). SQL **alat** yang ikut dijalankan (`tools/privilege_probe_readonly.sql`, `catalog_snapshot*.sql`, `ledger_*`, `owner_audit_readonly.sql`) **tidak** dikunci hash; penjaganya hanya review PR (T2) dan pemisahan alat/paket. Menambah hash untuk berkas itu butuh perubahan manifest (dilarang di PR-1) dan dicatat untuk PR-2.

**Rekomendasi (satu arsitektur final untuk PR-1): B, dengan batas keamanan yang dinyatakan secara jujur = A.** Batasnya adalah checksum terkunci + entri manifest spesifik + review independen + persetujuan Environment manual atas SHA yang sudah di-merge. **Jujur**: review belum diwajibkan oleh ruleset (lihat poin 6); satu-satunya gerbang keras saat ini adalah approval Environment atas SHA di `main`, ditambah proses Founder. Lint, `search_path`, `BEGIN READ ONLY` dan pemeriksaan efek adalah **lapisan tambahan** yang menangkap kecerobohan dan sebagian kelas serangan; tidak ada satu pun yang diklaim sebagai batas tunggal atau menyeluruh. `search_path = pg_catalog` **tidak** diklaim menjamin apa pun di luar yang tertera di "Apa yang dibuktikan dan tidak dibuktikan": ia menutup nama tak ber-schema, tidak menutup panggilan ber-schema, `SET search_path` oleh SQL, fungsi definer PUBLIC produk lain, maupun efek non-transaksional. Alasan memilih B: A saja sudah cukup sebagai batas bila reviewer membaca SQL, B menambah deteksi kecerobohan dengan biaya tanpa dependensi dan tanpa beban Founder tambahan, dan semuanya sudah teruji di PG nyata. C ditunda ke PR-2 **sebelum paket produksi nyata pertama selain p0-2**; PR-1 tidak menambah klaim yang belum dibuktikan. Catatan: p0-2 tidak berubah (diff `p0-2/`, `manifest.json`, `production-migration.yml` kosong).

## Lint SQL dan Allow-list per paket: tokenizer + tolak-semua-kecuali-yang-terdaftar (v2.1)
**Mengapa diganti.** Versi pertama (v2.0) membuang komentar `/* ... */` dengan regex lalu mencocokkan pola. Itu keliru: `select '/*'; <perintah>; select '*/';` membuat lint buta terhadap `<perintah>`, padahal `psql` tetap menjalankannya. QA independen #188 membuktikan tiga akibat: meta-perintah `\!` (menjalankan perintah di mesin runner yang memegang password migrasi), `DROP POLICY` di luar allow-list, dan `COMMIT` dini yang mematahkan atomisitas. Semuanya sudah ditutup dan diuji ulang (UNIT + SANDBOX, termasuk kontrol bahwa serangannya memang nyata di `psql`).

**Cara kerja sekarang** (`tools/run_package.py`):
1. Berkas dipecah menjadi token seperti PostgreSQL/psql membacanya: `'...'` (dengan `''`), `E'...'` (escape backslash), `$tag$...$tag$`, `"..."`, `U&`, komentar `--` dan `/* */` **bersarang**. Teks yang tidak bisa dipecah (literal/komentar tidak tertutup) = ditolak.
2. Pada token: backslash di luar literal (meta-perintah psql, termasuk `\gset`, `\g`, `\i`, `\copy`), `:var`/`:'var'` (psql mengganti isinya; hanya berkas D boleh memakai `:'created_by'`), `E'...'`, `U&'...'`, `set_config`, `nextval/currval/lastval/setval`, `pg_advisory*`, `dblink*`, `pg_read_file` dan sejenisnya (termasuk fungsi bawaan berefek samping seperti `pg_promote`, `pg_stat_reset`, `txid_current`, `pg_create_restore_point`) = ditolak di mana pun, juga bila ditulis ber-kutip (`"nextval"(...)` dinormalisasi lebih dulu). Teks SQL yang memuat karakter CR (`\r`) ditolak oleh tokenizer sendiri (psql mengakhiri komentar `--` pada CR, tokenizer tidak).
3. File dipecah menjadi pernyataan tingkat atas, dan **hanya kelas pernyataan yang terdaftar yang diterima** (tolak-semua-kecuali): `SET LOCAL lock_timeout/statement_timeout`; `DO` (isinya diperiksa pernyataan demi pernyataan); `SELECT/WITH` (tanpa `INTO`, tanpa CTE yang menulis, dan **pemanggilan fungsi default-deny**: kata + `(` hanya diterima bila (a) kata sintaks SQL yang tidak mungkin menjadi nama fungsi (kata RESERVED/col_name dari `pg_get_keywords()`, mis. `select`, `in`, `exists`, `values`, `coalesce`, `interval`), (b) fungsi bawaan murni dari daftar tetap `PURE_FUNCS` (tiap nama berstatus immutable/stable di `pg_proc`, atau read-only seperti `clock_timestamp`), atau (c) kata non-reserved pada konteks sintaks yang tepat (`order|group|partition by (`, `on conflict (` pada `INSERT` tanpa `JOIN`, `as not materialized (`, tipe `::timestamptz(3)`). Kata non-reserved seperti `set`, `first`, `key`, `range`, `rows`, `filter`, `over` di luar konteks itu adalah **nama fungsi yang sah** dan ditolak; fungsi ber-schema, tanpa schema, dan ber-kutip yang tidak ada di daftar = ditolak); `CREATE [OR REPLACE] FUNCTION public.x` (hanya `plpgsql`/`sql`, badan diperiksa); `ALTER TABLE public.x` (tambah kolom/constraint, default/not null, RLS); `CREATE [UNIQUE] INDEX` dan `CREATE TABLE` di `public`; `CREATE TEMP TABLE ... AS SELECT`; `COMMENT ON` tabel/kolom/fungsi `public`; `REVOKE/GRANT` di `public` (bukan ke `public/anon/authenticated`, tanpa `WITH GRANT OPTION`); dan kelas **bergerbang** di bawah. Pernyataan lain apa pun (`INSERT/UPDATE/DELETE` tak terdaftar, `ALTER POLICY`, `ALTER FUNCTION`, `ALTER SCHEMA`, `CREATE FUNCTION` di `storage`, `COMMENT`/`CREATE INDEX` di `storage`, `COPY`, `LOCK`, `VACUUM`, `DO` berisi DDL, `SET search_path`, dst.) = **ditolak**. Aturan yang sama berlaku di `DO` (`perform`, `x := fn()`, kondisi `if`/`for`, `raise`; kepala dan badan pernyataan diperiksa bersama), di `UPDATE/INSERT/DELETE` (termasuk panggilan ber-schema `public.fn()`; daftar kolom `insert into public.t (..)` dikenali dari kata sebelum nama schema), pada ekspresi DDL yang dijalankan saat apply (`ADD COLUMN ... DEFAULT`, `ADD CHECK`, `ALTER COLUMN SET DEFAULT`, `CREATE INDEX (ekspresi/WHERE)`, `CREATE TABLE` default/check/generated), dan pada `SELECT` sesudah `COMMIT`. `CREATE FUNCTION public.<nama>` yang namanya sama dengan fungsi bawaan murni (`md5`, `now`, `count`, ...) ditolak karena akan menimpa panggilan bawaan lewat overload (`md5(1)` memanggil `public.md5(int)`). `SET LOCAL lock_timeout` maksimal 10 detik dan `statement_timeout` maksimal 120 detik; nilai 0 (tanpa batas) atau lebih besar ditolak.
4. **Kelas bergerbang** wajib cocok persis dengan **satu entri `allow`** di manifest paket (kind + schema + objek + nama literal): `drop_policy`, `create_policy`, `drop_trigger`, `create_trigger` (+ `functions`), `drop_function` (cocokkan **signature** `nama(tipe,tipe)`, bukan nama saja), `update_rows` (`columns` + `WHERE` wajib, tabel ber-schema, tanpa `where true`/`1=1`, daftar `SET` diurai dengan hitungan kurung sehingga subquery tidak menyembunyikan kolom), `insert_rows` (daftar kolom eksplisit), `delete_from` (`WHERE` wajib, boleh dikunci ke satu fungsi), `revoke`/`grant` (objects + privileges + roles). Berlaku juga untuk `UPDATE`/`INSERT` ke tabel `public` yang dijalankan saat apply; hanya badan fungsi yang sekadar didefinisikan boleh memuat DML ke `public`. Rollback punya `rollback_allow` sendiri; `rollback_allowed_statements` dicocokkan sebagai kesamaan pernyataan (bukan substitusi teks). Entri yang tak dipakai (usang) = galat.
5. Nama diseragamkan sebelum dicek: `public."x"`, `"public"."x"`, `public . x`, `storage."fn"()` dianggap sama dengan bentuk polos pada penjaga produk lain (publoe/mitapeng/umkmpro), `public_refs`, `foreign_refs`, `ddl_targets`, dan allow-list. Nama schema/tabel ber-kutip yang bukan huruf kecil polos ditolak.
6. Transaksi: bentuk W (migrasi/rollback mentah) **tanpa** `begin/commit/rollback/savepoint/end/abort`. Berkas yang membawa transaksi sendiri (B dan E di semua bentuk, D, dan berkas bentuk N): tepat satu `begin` di awal dan satu `commit`; setelah `commit` hanya `SELECT` (tulis setelah commit = di luar transaksi atomik = ditolak).
7. Jaring kedua: pola `FORBIDDEN` lama (`owner\s+to`, `session_replication_role`, `pg_(try_)?advisory`, `EXECUTE` dinamis, "role membership grant", `ALTER DEFAULT PRIVILEGES`, `COPY ... PROGRAM`, ...) dijalankan pada teks token yang sudah diseragamkan, untuk setiap pernyataan yang tidak lolos lewat entri allow-list.
8. Berkas A/C/F/S/G dan semua probe dijalankan dalam `BEGIN READ ONLY` + snapshot (lihat "Model ancaman dan lapisan pengendali"): lapisan kedua di luar lint, hanya untuk berkas baca; berkas tulis (B/E/D) dijaga oleh pemeriksaan efek sebelum `COMMIT`.

**Batas yang diakui (bukan klaim "pasti aman").** Lint ini adalah tripwire teks, bukan bukti dan bukan batas keamanan. Pemanggilan fungsi bernama default-deny (hanya kata sintaks SQL, fungsi bawaan murni, dan kata non-reserved pada konteks tepat), dan kelas bypass yang dilaporkan QA (kata kunci sebagai nama fungsi, `case ... then perform(1)`, tipe `timestamptz(` pada ekspresi DDL, DML dan DDL ber-schema) ditutup dengan tes regresi. Yang **tidak** ditutup oleh lint:
- **Notasi atribut tanpa kurung** (`select t.fn from public.t t`, `(t).fn`): tidak terbedakan dari nama kolom tanpa katalog. Ditutup di sisi server oleh `search_path = pg_catalog` (fungsi di `public` tak ter-resolve), bukan oleh lint.
- **Fungsi pengguna pra-ada bernama sama dengan fungsi bawaan** (`md5`, `current_schema`, `format`, `left`, `right`, `replace`, `version`, juga kata `substring`/`overlay`): paket tidak boleh membuatnya (ditolak), yang sudah ada tidak terlihat dari teks. Ditutup oleh `search_path = pg_catalog` di sesi runner; di luar sesi runner (SQL Editor) tetap berlaku.
- Eksekusi kode pengguna tanpa menulis nama fungsi: operator buatan pengguna, cast/domain, view atau policy RLS yang memanggil fungsi, rule, trigger pada tabel yang ditulis, dan ekspresi di `CREATE POLICY`/`CREATE TRIGGER` (berjalan saat query). Pemeriksaan efek (poin 4) menangkap yang menulis tabel di luar daftar; yang membaca atau berefek non-transaksional tidak tertangkap.
- Lint tidak membuktikan bahwa `WHERE` bukan tautologi yang ditulis dengan cara lain (`id=id`, `id like '%'`) dan tidak membatasi isi policy.
Dampak yang sengaja dibiarkan (gagal-ditolak, bukan lolos): fungsi murni yang belum ada di `PURE_FUNCS` (mis. `pg_relation_size`, `random`, `lag` selain yang terdaftar) dan `from x join (subquery)` tanpa kata penghubung dikenali ditolak; daftar hanya diperluas lewat PR terpisah dengan bukti per fungsi (volatilitas di `pg_proc`). Penutup lain: `ddl_targets`/`public_refs`/`foreign_refs` yang dikunci di manifest, review PR oleh Founder, dan rehearsal SANDBOX. Aturan yang ditolak kode lint berlaku untuk semua paket; mengubahnya = mengubah `run_package.py` lewat PR yang Anda setujui (manifest paket tidak bisa melonggarkannya). Tanpa `allow`, kelas bergerbang ditolak seluruhnya.

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
| Semua SQL dikirim lewat `psql -c` dalam satu sesi: `search_path = pg_catalog, pg_temp`, timeout di dalam sesi, A/C/F/S/G/probe dalam `BEGIN READ ONLY` + snapshot | Berkas `p0-2` tidak berubah; `:'created_by'` diganti runner menjadi literal. Rehearsal p0-2 penuh (apply, C, D, F, rollback E) tetap hijau |
| B, E, dan D dipecah di `COMMIT`-nya dan diperiksa server sebelum `COMMIT` (tabel ditulis, fakta katalog, objek ditambah/dihapus, `txid`) | Jika p0-2 menulis di luar daftar yang diturunkan dari berkasnya, run STOP dengan ROLLBACK; di rehearsal tidak terjadi |
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
(Klaim "tanpa nama" berlaku untuk **keluaran runner**. Log job CI publik juga memuat beberapa baris dengan nama canary sintetis (`CANARY_*`) yang berasal dari log server container PostgreSQL yang dicetak saat teardown, bukan dari runner; namanya sintetis dan tidak berdampak.)

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
Pemilik dan hak nyata `storage.*`/`prompter_audit_logs`/fungsi di produksi; perilaku Supabase Storage nyata; apakah `PGOPTIONS` diteruskan oleh Supavisor (tidak lagi menentukan: timeout, `search_path` dan read-only kini diset di dalam sesi); hak `CREATE ROLE`/`ALTER ROLE ... SET` untuk `postgres` Supabase; pemilik objek `prompter_*` dan keanggotaan role pemilik (menentukan apakah `linoe_migrator` setara role berhak tinggi); jumlah fungsi `SECURITY DEFINER` produk lain dengan `EXECUTE` untuk PUBLIC di `umkmpro-ai` (hak tabel bukan batas bagi mereka); `track_counts` dan `pg_stat_xact_all_tables` pada tabel partisi, `storage`, `auth` produksi; versi mayor PostgreSQL produksi (rehearsal CI memakai 17) dan ekstensi (`pg_net`, `vault`, `pgsodium`); kunci tepat pada tabel hidup; apakah `pg_has_role(..., 'USAGE')` pada role Supabase nyata memberi hasil yang sama dengan SANDBOX; run pertama workflow di produksi (belum pernah ada); jalur "hapus baris ledger" di Supabase nyata.

## Dependensi
PR-2: `p0-3` + `l1-storage` (bentuk N pertama, entri `allow` nyata, tes terhadap berkas L1 asli sudah ada sebagai UNIT). PR-3: `p3-consent` (setelah #186 final). Opsi workflow baru hanya muncul setelah merge ke `main`.
