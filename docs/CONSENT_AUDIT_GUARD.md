# Paket 3: Consent & Audit Guard

Status: **Draft PR, BELUM diterapkan ke database mana pun, enforcement dan UI default MATI.** Bukan nasihat hukum.

## 1. Apa yang ada

| Bagian | Isi |
|---|---|
| Migrasi | `supabase/migrations/20261127100000_prompter_consent_audit_guard.sql`; rollback `supabase/rollback/20261127100000_prompter_consent_audit_guard.down.sql` |
| Penerimaan Terms | Dicatat server-side saat pendaftaran akun BARU: versi dari `features/legal/legal-versions.ts`, waktu dari server database (`occurred_at default now()`) |
| Privacy Notice | Dicatat TERPISAH sebagai `DELIVERED` (pemberitahuan telah disampaikan). Bukan persetujuan |
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

- **Saat flag OFF hanya Terms dan Privacy Notice yang tercatat** (saat pendaftaran). Persetujuan `CONNECT_*` BELUM dicatat oleh siapa pun karena dialog di halaman Koneksi belum ada; panel Privasi & persetujuan hanya tampil bila `CONSENT_UI_ENABLED` hidup. Artinya sebelum aktivasi, koneksi yang sudah ada tidak punya catatan persetujuan sama sekali.
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

0. **Keputusan produk: subjek persetujuan koneksi.** Persetujuan `CONNECT_*` diberikan oleh Owner tenant (hanya Owner yang dapat menghubungkan), tetapi pemakaian token dilakukan juga oleh anggota `marketing` (peluncuran kampanye, sinkron insight). Gerbang memeriksa persetujuan milik PENGGUNA YANG MENJALANKAN. Dengan enforcement ON, anggota marketing yang belum punya catatan akan ditolak (`NO_RECORD`) walau Owner sudah setuju. Putuskan sebelum aktivasi: periksa persetujuan Owner tenant, atau minta tiap pengguna.
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
