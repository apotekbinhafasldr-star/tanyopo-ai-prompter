# Paket 3: Consent & Audit Guard

Status: **Draft PR, BELUM diterapkan ke database mana pun, enforcement dan UI default MATI.** Bukan nasihat hukum.

## 1. Apa yang ada

| Bagian | Isi |
|---|---|
| Migrasi | `supabase/migrations/20261127100000_prompter_consent_audit_guard.sql` (+ revisi aditif `20261127110000_prompter_consent_owner_audit_redaction.sql`, bagian 8); rollback di `supabase/rollback/` (urutan terbalik: 110000 dulu) |
| Penerimaan Terms | Dicatat server-side saat pendaftaran akun BARU: versi dari `features/legal/legal-versions.ts`, waktu dari server database (`occurred_at default now()`) |
| Privacy Notice | Dicatat TERPISAH sebagai `DELIVERED` (pemberitahuan telah disampaikan), **hanya bila formulir mengirim `privacyNoticeVersion` yang sama PERSIS dengan `PRIVACY_NOTICE_VERSION`** (bagian 8). Bukan persetujuan |
| Persetujuan opsional | Katalog `prompter_consent_catalog` (v1: CONNECT_META dan CONNECT_TIKTOK aktif; CONNECT_X, MARKETING_COMMS, ANALYTICS_TELEMETRY terdaftar tetapi tidak aktif). Peristiwa `GRANTED` / `WITHDRAWN` per tujuan, versi, waktu, sumber |
| Retensi | `retain_until` nullable; parameter `evidence_retention_months` = NULL. Fungsi jadwal dan purge hanya operator |
| Guard audit | `prompter_audit_logs`: hak UPDATE/DELETE/TRUNCATE dicabut dari role klien + trigger penolak |
| Kode | `lib/consent/*`, `features/consent/*`, gerbang di titik koneksi Meta/TikTok, pencatat di `registerAction` |

Terms dan Privacy Notice **tidak** disamakan dengan persetujuan PDP, dan tidak semua pemrosesan dinyatakan berdasar persetujuan. Pemrosesan inti (akun, layanan, keamanan, audit, pembukuan) sengaja tidak dikemas sebagai persetujuan.

## 2. Yang JUJUR perlu diketahui

- **Bukan immutable.** Pemilik tabel/superuser tetap dapat menonaktifkan trigger atau mengubah hak. `service_role` tidak punya hak ubah/hapus pada audit dan tabel bukti, dan trigger menolak walau hak dikembalikan. Penghapusan tenant (ON DELETE CASCADE) tetap berjalan, jadi **catatan audit ikut terhapus bila tenant dihapus**. `TRUNCATE tenants CASCADE` akan ditolak oleh guard.
- **Enforcement MATI** (`CONSENT_ENFORCEMENT_ENABLED`, hanya `"true"`). Saat MATI: semua tetap dicatat, tidak ada yang diblokir, tidak ada panggilan database tambahan di gerbang. Saat HIDUP: fail-closed untuk pemrosesan opsional (koneksi Meta/TikTok): tanpa persetujuan aktif, galat pemeriksaan, timeout, atau tanpa klien = ditolak; koneksi lama tanpa catatan = **tidak dianggap setuju**. Fungsi inti (login, daftar, billing, dasbor) tidak pernah memanggil gerbang.
- **UI MATI** (`CONSENT_UI_ENABLED`, hanya `"true"`): panel "Privasi & persetujuan" terpasang di Pengaturan hanya bila flag ini hidup; tampilan produksi tidak berubah.
- **Label checkbox pendaftaran dan teks halaman legal publik TIDAK diubah** di PR ini (tes terkunci: tautan `/privacy` di label, pesan galat `auth-actions.test.ts:106`). Pemisahan visual blok Privacy Notice dan perubahan tes terkunci ditunda ke paket UI berikutnya (keputusan Founder terbuka). Pencatatan Terms/Privacy tetap berjalan di server tanpa mengubah UI.
- **Inventaris titik gerbang belum lengkap.** Terpasang pada: mulai OAuth (`lib/connectors/oauth-authorize.ts`), daftar Page Meta (`features/connections/actions.ts`), peluncuran kampanye (`features/campaigns/launch-actions.ts`), sinkron insight (`features/campaigns/sync-insights-actions.ts`). BELUM: eksekusi autopilot/persetujuan (`features/approvals/actions.ts`; sengaja, tindakan menurunkan belanja), pemeriksaan kesiapan Meta, dan jalur latar belakang bila ada. Lengkapi sebelum aktivasi.
- **Dialog persetujuan pada halaman Koneksi belum ada** (paket UI berikutnya). Server action `grantConnectionConsentAction` sudah tersedia. Selama dialog belum ada, enforcement tidak boleh dihidupkan: Owner tidak punya jalur memberi persetujuan koneksi.
- **Retensi 3 tahun = usulan internal belum disahkan.** Tidak ada angka di kode, migrasi, atau teks publik. Selama parameter NULL: jadwal dan purge mengembalikan `NOT_APPROVED` dan tidak menghapus apa pun. Tidak ada penjadwal otomatis.

- **Saat flag OFF hanya Terms (selalu) dan Privacy Notice (bila formulir mengirim versinya; Jalur 2 yang menambah kolom itu di UI) yang tercatat** (saat pendaftaran). Persetujuan `CONNECT_*` BELUM dicatat oleh siapa pun karena dialog di halaman Koneksi belum ada; panel Privasi & persetujuan hanya tampil bila `CONSENT_UI_ENABLED` hidup. Artinya sebelum aktivasi, koneksi yang sudah ada tidak punya catatan persetujuan sama sekali.
- **Keterbatasan yang diketahui (tidak diselesaikan di PR ini):** (1) rem permintaan `consent_set` bersifat memori per instance (best effort, 30/menit/pengguna), bukan batas global; (2) tidak ada pembatasan di database terhadap pengguna yang sengaja memanggil fungsi berulang; (3) akurasi `occurred_at` memakai `clock_timestamp()` (waktu server database), bukan jam klien; (4) hak asli grantor selain pemilik tabel tidak ditiru saat rollback (dipulihkan sebagai pemilik); (5) peristiwa persetujuan satu pengguna (`subject_user_id`) tidak mengikuti tenant bila pengguna pindah tenant (tenant_id hanya konteks saat pencatatan); (6) pengaturan retensi diisi langsung oleh operator (CHECK menolak 0, angka bernol di depan, dan nilai negatif; tidak ada catatan siapa yang mengisi selain log operasi).

## 3. Operator: retensi

Dijalankan pemilik database (tidak ada GRANT ke role mana pun, termasuk `service_role`):
1. Founder mengesahkan angka retensi secara tertulis. Isi parameter (satu pernyataan SQL oleh operator).
2. `select public.fn_prompter_consent_schedule_retention(true);` (dry-run), lalu `(false)` setelah persetujuan. Hanya mengisi `retain_until` untuk subjek yang peristiwa terakhirnya `WITHDRAWN`. Bukti Terms/Privacy (kontrak/pemberitahuan) tidak dijadwalkan otomatis: titik "akhir hubungan" belum diputuskan (UNKNOWN E-7).
3. `select public.fn_prompter_consent_evidence_purge(true);` dry-run: hanya hitungan per kode dan rentang usia, tanpa user id, tenant id, atau isi baris. Eksekusi nyata: `(false, '<referensi persetujuan tanpa PII>', <batch>)` dalam 1 jam setelah dry-run dengan hitungan SAMA; baris `legal_hold` dan `retain_until` NULL tidak pernah dihapus. Setiap panggilan tercatat di `prompter_consent_purge_runs` (hitungan saja).

## 4. Urutan migrasi dan rollback

**URUTAN WAJIB: terapkan migrasi LEBIH DULU, baru merge/deploy kode.** Kode pendaftaran memanggil `fn_prompter_record_signup_legal`; bila kode live sebelum migrasi, pemanggilan gagal (fail-open: pendaftaran tetap jalan, hanya log `signup_legal_record_failed`) dan pengguna baru pada jeda itu **tidak punya baris Terms/Privacy**. Kueri operator read-only untuk mendeteksi celah (hitungan saja, tanpa PII; ganti tanggal dengan waktu kode live):

```sql
select count(*) as pengguna_baru_tanpa_catatan_terms
from auth.users u
where u.created_at >= timestamptz '<waktu kode live, UTC>'
  and not exists (select 1 from public.prompter_legal_document_events e
                  where e.subject_user_id = u.id and e.doc_code = 'TERMS');
```
`auth.users` dibagi dengan produk lain: kueri hanya MEMBACA dan hanya menampilkan hitungan. Pengguna yang terlewat ditangani banner penerimaan ulang (paket UI berikutnya) atau keputusan Founder.

**Paket produksi (preflight, apply, verify, rollback) untuk Paket 3 BELUM ada dan dibutuhkan.** Pipeline produksi resmi hanya `p0-2`. PR ini tidak membuat atau mengubah `supabase/prod-packages/`; paket produksi (beserta PRECHECK/POSTCHECK, urutan setelah P0-3 dan Paket 2 L1, serta pemeriksaan ACL `prompter_audit_logs`) harus dibuat dan disetujui terpisah sebelum penerapan.

- Berkas migrasi ini berada **setelah** `20261126100000` (Paket 2 L1). Keduanya belum diterapkan.
- P0-3 (alert DOKU, `20261111130000`) **belum diterapkan di produksi**. Paket produksi butuh urutan yang benar dan paket baru. Pipeline produksi resmi saat ini hanya paket `p0-2`; **tidak ada paket produksi dibuat atau diubah di PR ini**.
- Sebelum penerapan: tinjau advisor keamanan, pastikan tidak ada bentrok nama pada proyek bersama `umkmpro-ai` (PUBLOE, MITAPENG, UMKMpro, Apotek), jalankan di jam sepi (lock_timeout 3 detik, statement_timeout 10 detik, transaksi eksplisit).
- Rollback: `supabase/rollback/...down.sql`. Menolak (RAISE) bila tabel bukti berisi baris; membuang bukti secara sengaja hanya dengan `PGOPTIONS="-c linoe.drop_evidence=YA"` setelah ekspor dan persetujuan. Memulihkan hak UPDATE/DELETE/TRUNCATE role klien persis seperti sebelum migrasi (hak lama ditangkap di `prompter_audit_guard_state`). Idempoten.
- **DILARANG menerapkan sebelum persetujuan Founder terpisah.**

## 5. Checklist sebelum enforcement dihidupkan

0. **Keputusan produk: subjek persetujuan koneksi, SUDAH diputuskan Founder (Opsi A).** Persetujuan `CONNECT_*` diberikan oleh Owner tenant dan diperiksa per TENANT (bagian 8): anggota marketing memakai persetujuan Owner tenantnya. Persetujuan Owner TIDAK otomatis mewakili semua subjek data dan BUKAN dasar hukum untuk semua pemrosesan (lihat UNKNOWN E-11).
1. Dialog persetujuan di halaman Koneksi tayang dan teruji; teks dialog diselaraskan dengan izin yang benar-benar diminta (UNKNOWN E-8).
2. Inventaris titik gerbang dilengkapi (bagian 2), termasuk jalur latar belakang.
3. Jumlah koneksi yang sudah ada tanpa catatan persetujuan diukur (UNKNOWN E-6): mereka akan ditolak sampai Owner memberi persetujuan.
4. Uji dengan enforcement ON pada basis uji (tanpa GRANTED ditolak; GRANTED lalu WITHDRAWN ditolak; galat pemeriksaan ditolak; kode tidak aktif ditolak).
5. Pembalikan: kosongkan `CONSENT_ENFORCEMENT_ENABLED` (perubahan env Netlify, butuh persetujuan Founder).

## 6. Kelas bukti

| Kelas | Isi |
|---|---|
| SANDBOX | `supabase/tests/consent-audit-guard/run-local.sh` pada PostgreSQL sementara, data sintetis, skema Supabase berupa stub (job CI `consent-audit-guard-sql`, PG17); log di `docs/consent-audit-guard/SANDBOX_LOG.txt` |
| CI (vitest) | Tes unit dan statis; dijalankan oleh CI pada PR ini |
| Simulasi lokal | Logika murni (`lib/consent/*`) diuji dengan tsx pada mesin pengembang |
| REAL | **Belum ada.** Tidak diterapkan atau diuji di Supabase nyata |

## 7. UNKNOWN hukum (butuh konsultan)

Dasar pemrosesan koneksi platform (kontrak vs persetujuan) dan peran LINOE (E-3); dasar fitur AI (E-2); lama dan titik mulai retensi bukti serta apakah bukti Terms berbeda dari bukti persetujuan (E-7); perlu tidaknya IP/perangkat sebagai bukti (E-4, default tidak disimpan); aturan pemasaran langsung (E-9) dan telemetri (E-10); apakah penerimaan ulang Terms harus blocking (E-5); persetujuan Owner untuk anggota tim lain (E-11); kecukupan teks penarikan (E-12); jalur pendaftaran lain di proyek bersama (E-14); bentrok objek dengan produk lain (E-15). Daftar huruf dasar pemrosesan UU PDP belum diverifikasi ulang (E-1): klasifikasi dasar bersifat usulan.

## 8. Revisi Jalur 1 (migrasi tambahan 20261127110000)

**Pilihan: berkas BARU, bukan menyunting 20261127100000.** Hash paket migrasi pertama sudah terkunci di PR #186 dan jalur produksi (preflight/POSTCHECK) mengacu ke isinya; menyunting berkas yang sudah ditinjau mengubah hash dan membatalkan tinjauan. Migrasi kedua bersifat aditif dan idempoten (`create or replace`, `if not exists`, `on conflict do nothing`), dengan rollback sendiri yang memulihkan isi fungsi lama persis (diuji: keadaan setelah down = keadaan setelah migrasi pertama). Keduanya BELUM diterapkan di mana pun; urutan terapan: 100000 lalu 110000.

### 8.1 Persetujuan koneksi hanya Owner (Opsi A)
- `fn_prompter_consent_set(p_code, p_action, p_source, p_tenant_id default null)`: untuk kode `CONNECT_*` tenant dan peran diambil dari `user_profiles` milik `auth.uid()` (bukan dari klien). Ditolak (42501) bila pemanggil bukan `owner`, tidak punya tenant, atau `p_tenant_id` berbeda dari tenant pemanggil (Owner tenant lain). `anon` tidak punya EXECUTE. Berlaku juga bila RPC dipanggil langsung, tidak hanya lewat server action. Fungsi 3 argumen lama dibuang agar tidak ada overload ambigu.
- Status koneksi milik TENANT: Owner kedua dan non-Owner melihat persetujuan tenant (`fn_prompter_consent_my_status`, SECURITY DEFINER terbatas pada tenant pemanggil); penarikan oleh Owner mana pun berlaku untuk tenant.
- `fn_prompter_consent_check_tenant(user, code, tenant)` (hanya `service_role`): pengguna harus anggota tenant; persetujuan = peristiwa terakhir tenant; pemberinya HARUS masih Owner tenant itu (`GRANTOR_NOT_OWNER` bila diturunkan); persetujuan Owner tenant lain tidak berlaku (`NOT_IN_TENANT`/`NO_RECORD`). `requireConsent(code, userId, tenantId)` memakai ini; tanpa `tenantId` = ditolak (fail-closed saat enforcement ON, no-op saat OFF).
- Batas: persetujuan Owner BUKAN persetujuan setiap subjek data (mis. pelanggan/anggota tim) dan BUKAN dasar hukum seluruh pemrosesan. Dasar hukum pemrosesan koneksi tetap UNKNOWN (E-3, E-11).
- Penarikan persetujuan koneksi: pencabutan akses di sisi platform (Meta/TikTok) adalah **best effort**; LINOE memutus koneksi dan menghapus token sendiri, tetapi tidak dapat menjamin platform mencabut izin di sisinya. Teks di layar menyatakan ini.
- `prompter_consent_events.text_sha256` menyimpan hash teks versi yang disetujui/ditarik (baris sebelum revisi NULL).

### 8.2 Privacy Notice DELIVERED: kontrak formulir
`registerAction` mencatat `PRIVACY_NOTICE`/`DELIVERED` hanya bila `FormData` memuat `privacyNoticeVersion` yang **sama persis** (string) dengan `PRIVACY_NOTICE_VERSION` (`"1"`; `"01"`, `" 1"`, `"1.0"`, `"2"`, kosong, atau tidak ada = tidak dicatat). `TERMS`/`ACCEPTED` selalu dicatat. Di database, `fn_prompter_record_signup_legal(user, terms, privacy)` menerima `privacy = NULL` (tidak dicatat). Jalur 2 (UI pendaftaran) wajib menambah input tersembunyi/terlihat `privacyNoticeVersion` HANYA bila blok Privacy Notice benar-benar ditampilkan; sebelum itu tidak ada baris DELIVERED baru.

### 8.3 Anonimisasi PII pada `prompter_audit_logs` (jalur sempit, operator)
Guard TETAP menolak setiap UPDATE/DELETE/TRUNCATE kecuali cascade tenant dan SATU jalur: fungsi operator `fn_prompter_audit_redact(request_ref, tenant, dry_run default true, batch)`.
- **Tanpa GRANT** ke role mana pun (diperiksa juga `session_user`); hanya pemilik database/operator.
- **Dry-run wajib**: eksekusi hanya diterima bila ada dry-run dengan `request_ref` sama (<= 7 hari) untuk tenant itu. Dry-run dan eksekusi masing-masing menulis SATU entri audit sendiri (`AUDIT_PII_REDACTION_DRYRUN` / `AUDIT_PII_REDACTION`) berisi HITUNGAN saja (`rows_matched`, `rows_redacted`, `remaining`) dan `request_ref`; tanpa PII.
- **Allowlist** `prompter_audit_redaction_allowlist(resource_type, json_key)` (tabel privat, tanpa hak klien, tidak dapat di-UPDATE/DELETE oleh trigger; perubahan lewat migrasi): seed hanya `prompter_manual_ad_metrics` dengan `entered_by` dan `updated_by` (id pengguna yang tersalin lewat `to_jsonb(row)` oleh trigger `fn_prompter_manual_ad_metrics_audit`; kolom lain tabel itu bukan PII). Tipe sumber bernama finance/ledger/payment/billing/security/budget/automation/emergency/auth/tenant/profile ditolak oleh CHECK dan oleh fungsi.
- **Yang diubah**: hanya kunci allowlist pada kolom `before_data`/`after_data`/`context`, nilainya diganti penanda `[DIHAPUS-PII]`. `id`, `tenant_id`, `actor_user_id`, `action`, `resource_type`, `resource_id`, `created_at` TIDAK berubah (guard memeriksa itu). Idempoten (nilai yang sudah penanda tidak dihitung). Per batch (1-5000, default 500) dengan `for update skip locked`, `lock_timeout 3s`, `statement_timeout 30s`.
- **Mengapa bypass sulit**: pembukaan guard memakai nonce acak per transaksi dari tabel privat; GUC `set_config` dari klien tidak cukup (nonce tidak dapat ditebak, klien tidak punya hak tulis/baca tabel itu, dan tidak punya hak UPDATE). Diuji: set_config dari klien, GUC retensi/purge lama, `session_replication_role=replica` oleh klien, search_path (semua fungsi DEFINER mengunci `search_path`), dan pemilik dengan nonce tebakan: semua ditolak. Pemilik/superuser tetap dapat menonaktifkan trigger (bukan klaim immutable).
- **Tidak disentuh**: `finance_audit_logs`, ledger/alert pembayaran, audit keamanan, Emergency Stop, `budget_policies`, `automation_settings`, `auth.users`, `tenants`, `user_profiles` (hanya dibaca), tabel/trigger produk lain (uji sandbox S12/S14 memeriksa tabel stub finansial tidak berubah).

### 8.4 PII lewat `before_data` (trigger manual_ad_metrics) dan prasyarat Paket 4b-2
- Trigger audit `manual_ad_metrics` menyalin SELURUH baris (`to_jsonb`) ke `before_data`/`after_data`; PII di sana hanya `entered_by`/`updated_by` (id pengguna, pseudonim). Trigger itu **tidak diubah** (milik produk bersama).
- Pembersihan per tenant/tabel: `fn_prompter_audit_redact` (8.3). Pemindaian canary baca-saja: `select * from public.fn_prompter_audit_pii_canary_scan('<tenant atau NULL>')` mengembalikan HITUNGAN per `kind`: `ALLOWLISTED_UNREDACTED` (PII allowlist yang masih ada) dan `UNLISTED_CANDIDATE` (kunci mirip PII yang BELUM di allowlist; perlu ditinjau manusia). Tanpa grant (operator).
- **PRASYARAT Paket 4b-2**: sebelum jalur data/ekspor/penghapusan Paket 4b-2 dijalankan, operator (a) menjalankan canary scan, (b) meninjau semua `UNLISTED_CANDIDATE`, (c) menambah allowlist lewat migrasi bila perlu, (d) menjalankan dry-run lalu eksekusi anonimisasi per tenant yang relevan, (e) memastikan canary `ALLOWLISTED_UNREDACTED` = 0. Cakupan kunci PII di luar seed adalah UNKNOWN sampai audit data produksi (tidak dilakukan; tidak ada akses).

### 8.5 SLA akses internal vs batas waktu hukum
SLA internal akses data **48 jam** adalah target OPERASIONAL internal, bukan batas hukum. Batas hukum berbeda per jenis permintaan (3x24 jam hanya untuk Pasal 30, 32, 40, 41, 46) dan tetap UNKNOWN sampai diverifikasi konsultan. Retensi 3 tahun masih usulan internal belum disahkan; tidak ada angka di kode/migrasi/teks publik.

### 8.6 Aksesibilitas panel
Pil sakelar kini memakai warna dengan kontras >= 3:1 pada kedua keadaan (abu `#71717a` = 4.83:1, brand `#4338ca` = 7.9:1 terhadap putih; kenop putih), teks abu pada `surface-muted` diganti `foreground` (abu `#71717a` di atas `#f4f4f5` hanya 4.4:1), nama aksesibel sakelar memuat teks yang terlihat ("Judul Aktifkan/Matikan"), dan fokus kembali ke judul kartu setelah sukses (sudah ada).

### 8.7 Ditunda / UNKNOWN
Dasar hukum peraturan pelaksana UU PDP: **dasar hukum belum terverifikasi (UNKNOWN)** (rujukan bernomor yang tidak terverifikasi dihapus dari seluruh repo). Cakupan PII di audit produksi, angka retensi, SLA hukum per jenis permintaan, kecukupan persetujuan Owner untuk subjek data lain: UNKNOWN. Label checkbox, `legal-pages.test.tsx:203`, `auth-actions.test.ts:106`, dan `auth-register-legal-record.test.ts:88` milik Jalur 2 dan tidak diubah di sini.
