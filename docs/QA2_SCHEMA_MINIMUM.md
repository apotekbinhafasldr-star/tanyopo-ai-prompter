# QA-2: skema minimum proyek Supabase QA

**Status: NOT APPLIED.** Hanya manifest, shim, skrip pembangun, dan tes. Tidak ada SQL yang dijalankan di database mana pun, tidak ada perubahan Supabase/Resend/DNS/Netlify/secret.

**HANYA UNTUK PROYEK QA gasdqsadnjoknisloaec** (`linoe-qa-real-email`, masih kosong). Jangan pernah ke `umkmpro-ai` (proyek bersama UMKMpro) atau proyek lain.

Sumber kebenaran: [`qa/qa2-schema-manifest.json`](../qa/qa2-schema-manifest.json). Dasar: `origin/main` fba8167.

## Status #154
**HOLD (Draft). Tidak ada P0. Siap untuk persetujuan MERGE (hanya berkas manifest/shim/skrip/tes/dokumen; tidak mengubah migrasi atau kode aplikasi), BELUM siap APPLY ke proyek QA.** Diaudit terhadap `main` 18db8c2 (kode aplikasi jalur signup/onboarding/trial identik dengan basis fba8167; yang berubah di main hanya skrip/dokumen/tes QA). Tidak ada SQL yang dijalankan di database mana pun.

| Prioritas | Temuan (terbukti dari kode) | Status |
|---|---|---|
| P0 | Tidak ada | - |
| P1 | Reset identitas QA lewat Admin API (`deleteUser`, langkah 1 dan 11 orkestrator) GAGAL setelah onboarding: `prompter_audit_logs.actor_user_id` merujuk `auth.users` tanpa ON DELETE | **Diperbaiki di shim** (trigger khusus QA `qa2_before_auth_user_delete`), diuji statis; perilaku produksi UNKNOWN |
| P1 | Orkestrator membaca `trial_ends_at`; kolom itu TIDAK ADA di skema (adanya `current_period_end`) | Kontrak untuk admin client: wajib memetakan `current_period_end` ke `trial_ends_at` (7.8). Orkestrator bukan berkas milik PR ini |
| P1 | Grant Data API proyek QA (authenticated/service_role) bergantung pada default Supabase | Grant minimal ditambahkan di shim; verifikasi akhir bundel memeriksa `authenticated_access`, `service_role_access`, `app_table_grants` |
| P1 | Role pendaftar produksi dan isi `handle_new_user` produksi (baris tambahan) tidak terbukti | UNKNOWN; shim memakai `owner` (inferensi), kueri baca-saja di 7.5 |

**Harus dibuktikan/diputuskan Founder SEBELUM apply** (frasa `APPROVE QA-2-SCHEMA-BUNDLE`):
1. Ref di URL dashboard = `gasdqsadnjoknisloaec`, proyek masih kosong, Data API aktif.
2. Ada yang menyediakan admin client QA yang memetakan `current_period_end` ke `trial_ends_at` (belum ada di main).
3. Bukti produksi (kueri baca-saja 7.5) untuk role default dan `handle_new_user`, atau terima risiko false pass.
4. Pakai `--parts 3` dari HP, jalankan 1, 2, 3 berurutan, dan hasil verifikasi akhir semua benar.
5. Subset ini belum pernah dijalankan di Postgres: terima risiko, atau minta job CI lokal lebih dulu.

## 1. Apa yang disentuh alur (hasil telusur kode)
| Langkah | Kode | Objek DB |
|---|---|---|
| Signup | `features/auth/actions.ts` (`auth.signUp`) | `auth.users` (bawaan) + **trigger signup UMKMpro `handle_new_user`** membuat `tenants` + `user_profiles` (shim) |
| Konfirmasi email | `app/auth/confirm/route.ts` (`verifyOtp`) | Hanya Auth. Tidak ada tabel |
| Gerbang sesi | `services/session.ts` | `user_profiles`, `tenants`, `prompter_brand_profiles` |
| Onboarding 8 langkah | `features/onboarding/actions.ts` | `fn_current_tenant_id()`, `prompter_brand_profiles` (upsert), `prompter_audit_logs` |
| Dashboard | `app/(app)/layout.tsx`, `dashboard/page.tsx` | `prompter_subscriptions` (baca banner), `prompter_analytics_insights` |
| Trial 14 hari | `services/billing.ts#getOrCreateSubscription`, `/billing` | INSERT `prompter_subscriptions` lalu trigger server `trg_prompter_subscriptions_enforce_trial_insert` (14 hari, jam server); baca `prompter_ai_jobs`, `prompter_attributions`, `prompter_invoices`; `fn_set_trial_plan_preference` |

Temuan penting: trigger trial memberi nilai ke kolom `cancel_at_period_end` dan `provider_subscription_id`. Kolom itu baru ada di migrasi B10 (`20260915051359`), jadi B10 **wajib** ikut walau isinya soal pembayaran. Tanpa B10 INSERT trial gagal.

## 2. Urutan apply (bagian 0 = shim, lalu 15 migrasi)
| # | Berkas | Alasan |
|---|---|---|
| 0 | `qa/qa2-shim.sql` | Prasyarat UMKMpro (lihat bagian 4). Guard: menolak jika proyek tidak kosong |
| 1 | `20260829080127_prompter_foundation_schema` | brand_profiles, audit_logs, automation_settings |
| 2 | `20260829080155_prompter_fix_function_search_path` | search_path fungsi updated_at |
| 3 | `20260829092303_prompter_phase1_schema` | ai_jobs (dibaca /billing), products, master_campaigns |
| 4 | `20260829095447_prompter_phase2_schema` | attributions (dibaca /billing), conversions |
| 5 | `20260829102304_prompter_phase3_schema` | platform_capabilities (target ALTER migrasi 10) |
| 6 | `20260829110644_prompter_phase5_schema` | seo_projects (target ALTER migrasi 10) |
| 7 | `20260829114414_prompter_phase7_schema` | analytics_insights (dibaca /dashboard) |
| 8 | `20260901120847_prompter_billing_foundation` | tabel subscriptions |
| 9 | `20260901130513_prompter_billing_invoices` | tabel invoices |
| 10 | `20260901135021_prompter_global_edition_foundation` | kolom negara/mata uang di brand_profiles, subscriptions, invoices |
| 11 | `20260910072819_prompter_subscriptions_add_starter_plan` | CHECK plan |
| 12 | `20260915043800_prompter_b9_entitlement_enforcement` | plan_entitlements (FREE aktif) + trigger guard plan |
| 13 | `20260915051359_prompter_b10_payment_billing_core` | kolom subscriptions + policy insert trial (bawa juga objek pembayaran yang tidak dipakai alur) |
| 14 | `20261019100100_prompter_p0_subscription_trial_insert_guard` | **guard trial 14 hari** |
| 15 | `20261029220000_prompter_p0_subscription_plan_tampering_lockdown` | blokir UPDATE klien + `fn_set_trial_plan_preference` |

Pemeriksaan dependensi (nama tabel/fungsi lintas migrasi) dilakukan statis: tidak ada migrasi minimum yang memakai objek yang hanya didefinisikan di migrasi yang dikecualikan.

## 3. TIDAK diperlukan (35 migrasi)
| Kelompok | Contoh | Catatan |
|---|---|---|
| iklan | `manual_ad_metrics`, `meta_page_picker`, `channel_campaigns_*`, `phase6_capabilities`, `master_campaigns_add_selected_media` | kampanye/iklan di luar alur |
| finance-admin | `linoe_finance_foundation`, `admin_center_access`, `accounting_ledger`, `tax_optimization_approvals` | Admin Center mati (`ADMIN_CENTER_ENABLED` jangan diisi) |
| pembayaran (DOKU/Midtrans) | `b1`, `b2`, `b4`, `b4_2`, `p0_2`, `p0_3`, cron x2, `payment_lifecycle_remediation` | cron butuh ekstensi pg_cron |
| ai | `ai_router_usage_columns`, `demo_ai_usage`, `growth_recommendation_*` | AI generation di luar alur |
| lain | `job_queue`, `global_marketing_blueprint`, `compliance_flags_*`, `seo_discovery_no_website`, `product_stock_unit`, `phase4` (handoff UMKMpro) | tidak disentuh alur |

Daftar lengkap + alasan per berkas ada di `excluded` pada manifest. Tes memastikan `migrations + excluded` = semua migrasi repo, jadi migrasi baru tidak bisa luput dikaji.

**Opsional** (tidak termasuk minimum; tambahkan ke `migrations` manifest dengan urutan nama bila QA ingin menguji): `trial_expiry_gate_fix` (trial kedaluwarsa), `p0_ai_jobs_lockdown`, `p0_plan_entitlements_lockdown`, `ai_jobs_quota_guard`, `ai_jobs_delete_guard` (kuota AI trial S1), `b1_trial_remainder_carryover` (sisa trial saat bayar pertama).

## 4. Prasyarat milik UMKMpro (shim) dan risiko fidelitas
| Objek | Sumber shim | Risiko fidelitas |
|---|---|---|
| `public.tenants` (6 kolom saja) | `qa/qa2-shim.sql` | **TINGGI**: produksi punya ~30 kolom lain, default/CHECK tidak diketahui |
| `public.user_profiles` | idem | **TINGGI**: CHECK role dan default tidak diketahui |
| `fn_current_tenant_id()`, `fn_current_role()` | idem | SEDANG: isi dari catatan katalog, grant/ACL tidak diketahui |
| `handle_new_user()` + trigger `qa_on_auth_user_created` | idem (simulasi) | **TINGGI**: badan asli ada di UMKMpro, hanya meniru perilaku di `docs/DATABASE.md` |
| `_linoe_sandbox_marker`, `_linoe_sandbox_applied` | idem | Rendah: milik QA, bukan UMKMpro |

**Shim BUKAN produksi.** Lulus di QA tidak membuktikan perilaku UMKMpro (policy admin, trigger tambahan, nilai default). `qa/qa2-shim.sql` adalah salinan terlabel dari shim CI QA-1 (`supabase/sandbox/doku/01_shim_shared_objects.sql` + `qa/supabase-local/sql/01_handle_new_user_simulation.sql`); tes menjaga isinya tetap identik. Header DOKU sengaja tidak disalin.

**Dilarang ada di QA:** apa pun yang menyentuh `umkmpro-ai`, modul PUBLOE/MITAPENG/UMKMpro, referensi proyek nyata, `DROP TABLE`, `TRUNCATE`, `ALTER` pada `tenants`/`user_profiles`, `CREATE EXTENSION`, `cron.schedule`, tabel `public` di luar awalan `prompter_`/`_linoe_sandbox_`. Skrip menolak bundel yang melanggar. Ref proyek nyata yang tertulis di komentar migrasi (`phase2/3/5/7`) disamarkan di salinan bundel saja; berkas migrasi di repo tidak diubah.

## 5. Cara paling sederhana dari HP: berkas .sql (dibagi bila besar)
Skrip `scripts/qa/build-schema-bundle.mjs` (node murni, tanpa dependensi, tidak terhubung ke database mana pun) menggabungkan shim + 15 migrasi. Satu berkas = **165 KB** (KB = 1024 byte), di atas batas nyaman tempel dari HP (100 KB), jadi pakai `--parts`. Urutan migrasi **tidak berubah**; pemisahan hanya di batas migrasi.
```
node scripts/qa/build-schema-bundle.mjs --out /path/di/luar/repo/qa2.sql                # 1 berkas, 165 KB, satu transaksi
node scripts/qa/build-schema-bundle.mjs --out /path/di/luar/repo/qa2.sql --parts 3      # disarankan untuk HP
node scripts/qa/build-schema-bundle.mjs --check                                         # validasi saja
```
| Mode | Berkas | Ukuran | Isi |
|---|---|---|---|
| 1 berkas | `qa2.sql` | 165 KB | semua, atomik penuh |
| `--parts 2` | part1of2 / part2of2 | 85 / 83 KB | shim..`phase7` / `billing_foundation`..`lockdown` |
| `--parts 3` (disarankan) | part1of3 / 2of3 / 3of3 | 50 / 55 / 64 KB | shim..`phase2` / `phase3`..`starter_plan` / `b9`..`lockdown` |

**Cara pakai dari HP (disarankan `--parts 3`):**
| Urut | Berkas | Ukuran | Migrasi di dalamnya | Versi terakhir (cek sesudahnya) |
|---|---|---|---|---|
| 1 | `qa2.part1of3.sql` | 50 KB | shim + `foundation`..`phase2` (4 migrasi) | `20260829095447` |
| 2 | `qa2.part2of3.sql` | 55 KB | `phase3`..`starter_plan` (7 migrasi) | `20260910072819` |
| 3 | `qa2.part3of3.sql` | 64 KB | `b9`, `b10`, `trial_insert_guard`, `plan_tampering_lockdown` (4 migrasi) | `20261029220000` |

Aturan: jalankan **berurutan** 1, 2, 3; urutan migrasi sama dengan manifest (tidak ada yang dipindah). Tiap potongan atomik (satu transaksi). Guard antar-bagian (di awal potongan 2 dan 3, di luar transaksi): menolak jalan bila versi terakhir potongan sebelumnya belum tercatat di `_linoe_sandbox_applied` ("ABORT: bagian sebelumnya belum diterapkan") atau bila potongan itu sendiri sudah diterapkan ("ABORT: bagian ini sudah diterapkan"). Potongan 1 menolak proyek yang tidak kosong. Cek manual antar potongan (BACA-SAJA): `select max(version) from public._linoe_sandbox_applied;` harus sama dengan kolom "Versi terakhir" di atas. Bila satu potongan gagal, isinya tidak tersimpan, potongan sebelumnya tetap; kirim galatnya (rollback tetap = hapus dan buat ulang proyek). Hanya potongan terakhir yang menutup dengan baris verifikasi. Tes memastikan ukuran, urutan, dan guard ini.

Langkah Founder (Android Chrome, mode "Situs desktop" bila perlu), **setelah** menulis `APPROVE QA-2-SCHEMA-BUNDLE`:
1. Sesi Claude membangun berkas dan membagikannya (mis. tautan/Drive). Buka satu potongan di HP, pilih semua, salin.
2. Dashboard Supabase, buka proyek dengan ref **gasdqsadnjoknisloaec** (cek di URL; header tiap potongan berisi `HANYA UNTUK PROYEK QA gasdqsadnjoknisloaec`). Jangan lanjut bila ref berbeda.
3. SQL Editor, query baru, tempel, Run. Konfirmasi peringatan "destructive" bila muncul (dari `drop trigger/policy if exists` dan `revoke` di migrasi). Ulangi untuk potongan berikutnya.
4. Hasil potongan terakhir harus: `migrations_applied=15`, `trial_trigger=O`, `free_plan_active=1`, `signup_trigger=1`, `shim_policies=3`, `authenticated_access=true`, `service_role_access=true`, `app_table_grants=true`, `reset_trigger=1`. Nilai `false` pada tiga kolom grant = grant Data API proyek QA tidak otomatis (lihat 7.8); STOP, jangan lanjut uji.

## 6. Rollback dan reset QA
**Rollback skema:** tidak ada per-migrasi. Proyek QA terpisah dari produksi, jadi rollback = **hapus lalu buat ulang proyek QA** (ref baru harus diganti di allowlist lewat PR kecil tersendiri), lalu terapkan ulang bundel. Guard "proyek kosong" menolak menjalankan bundel dua kali.

**Reset data QA (tanpa membuat ulang proyek), hanya di proyek QA, butuh persetujuan Founder:** menghapus user Auth tidak menghapus `tenants` (hanya `user_profiles` lewat FK), sehingga tenant yatim dan data `prompter_*` menumpuk. Urutan yang benar:
1. Cetak SQL (tanpa koneksi DB; tidak menjalankan apa pun): `node scripts/qa/print-qa-reset-sql.mjs --ref gasdqsadnjoknisloaec --out /path/di/luar/repo/qa2-reset.sql`. Skrip menolak ref selain allowlist QA dan ref proyek nyata; SQL-nya menolak jalan bila penanda `QA2_SANDBOX_ONLY` tidak ada.
2. SQL Editor proyek **gasdqsadnjoknisloaec** (cek URL): tempel, Run. Satu transaksi: hapus tenant milik `qa-linoe@example.test` (cascade ke profil dan seluruh `prompter_*` termasuk trial), lalu sapu tenant yatim. Harapan: `qa_tenants_left=0`, `orphan_tenants=0`.
3. Hapus user Auth QA lewat dashboard (Authentication, Users) atau Admin API khusus proyek QA. Urutan penting: tenant dulu, user kemudian, karena `prompter_audit_logs.actor_user_id` merujuk `auth.users` tanpa cascade (khusus QA, trigger shim `qa2_before_auth_user_delete` juga menghapus tenant otomatis bila user dihapus lewat Admin API/dashboard, sehingga urutan ini tidak lagi wajib; langkah SQL tetap berguna untuk menyapu tenant yatim lama). (Opsi `--with-auth-user` menambah `DELETE FROM auth.users`; bukan jalur resmi, UNKNOWN.)
4. Setelah itu email QA yang sama bisa mendaftar lagi dan mendapat tenant + trial 14 hari baru.

## 7. Audit fidelitas shim (terhadap alur signup/onboarding nyata)
Dasar: telusur kode + repo saja. Tidak ada query ke `umkmpro-ai` atau database mana pun; semua tentang produksi yang tidak ada di repo ditandai UNKNOWN.

### 7.1 Akses kode ke objek UMKMpro dan padanannya di shim
| Jalur (kode) | Akses | Shim | Status |
|---|---|---|---|
| `features/auth/actions.ts` signUp | metadata `nama`, `nama_usaha`, `jenis_usaha="lainnya"` | `handle_new_user` membaca ketiganya, INSERT `tenants(nama_usaha, jenis_usaha, email)` + `user_profiles(id, tenant_id, nama, role='owner')` | Kunci metadata cocok. Komentar kode menyebut trigger produksi juga membuat baris `business_template`: tidak ada di shim (UNKNOWN: baris/tabel lain apa lagi) |
| `app/auth/confirm/route.ts`, `proxy.ts`, `lib/supabase/*` | Hanya Auth (`verifyOtp`, `getUser`, kunci publishable) | tidak ada | Tidak bergantung pada shim |
| `services/session.ts` | `user_profiles` SELECT `nama, role, tenant_id` `.single()` by `id`; `tenants` SELECT `nama_usaha` by `id`; semua lewat RLS sesi pengguna | policy SELECT `user_profiles` (satu tenant), `Lihat tenant sendiri` | Cocok. Tanpa baris profil => `/session-error` (perilaku sama di produksi) |
| `features/onboarding/actions.ts` | rpc `fn_current_tenant_id` lalu upsert `prompter_brand_profiles`, insert `prompter_audit_logs` | fungsi `SECURITY DEFINER` + search_path | Cocok. RLS tabel itu memakai `fn_current_role() in ('owner','marketing')` (56 pemakaian): shim memberi `owner` |
| `services/billing.ts`, `/billing` | INSERT `prompter_subscriptions` (policy memakai `fn_current_tenant_id`); `isOwner = role === 'owner'` untuk form paket; `fn_set_trial_plan_preference` butuh `fn_current_tenant_id` + `fn_current_role() = 'owner'` | sama | Cocok bila role pendaftar produksi = `owner` (lihat R3) |
| `tenants` UPDATE / `user_profiles` UPDATE | Tidak dipanggil di alur (tipe mengizinkan `nama_usaha/email/logo_url` dan `nama`) | policy UPDATE tenants ada, user_profiles tidak | Tidak teruji alur |
| Trigger `auth.users` | signUp memicu `handle_new_user` saat INSERT (belum konfirmasi) | trigger `qa_on_auth_user_created` AFTER INSERT | Cocok dengan `docs/AUTH_RECOVERY.md` (baris dibuat saat signup) |

### 7.2 Bukti fidelitas yang ada di repo, dan batasnya
| Bukti | Menunjukkan | Batas |
|---|---|---|
| `types/database.ts` | kolom `tenants` (6), `user_profiles` (5), `TenantRole` = owner/apoteker/kasir/admin_gudang/hr/marketing | slice tangan, bukan skema produksi |
| `supabase/tests/s1-trial-quota/support/prod_snapshot.sql` | isi `fn_current_*`, 2 policy tenants, catalog dibaca sesi lama | tidak dapat diverifikasi ulang; di sana UPDATE tenants `to public`, di shim `to authenticated` (shim mengikuti perbandingan metadata 2026-11-09 yang tidak disimpan di repo): UNKNOWN mana yang benar |
| `docs/DATABASE.md`, `docs/AUTH_RECOVERY.md` | `handle_new_user` milik UMKMpro membuat tenants + user_profiles untuk SEMUA produk | role awal tidak disebut |
| Migrasi (policy/FK/fungsi) | 41 pemakaian `role in ('owner','marketing')`, 15 `role = 'owner'`; FK `user_profiles(id)` di B10 | hanya yang diasumsikan, bukan yang ada |
| CI QA-1 `signup-e2e` | alur berjalan di Auth lokal + shim yang sama; trigger trial aktif; daftar ulang email sama ditolak | INTEGRATION: grant default Supabase lokal; tidak menguji isolasi tenant, role selain owner, atau grant hosted |
| Komentar `features/auth/actions.ts` (2026-09) | alur nyata sudah terbukti hidup di produksi (template konfirmasi, Site URL) | klaim komentar, tidak diverifikasi di sini |

UNKNOWN (hanya ada di produksi): ~30 kolom `tenants` lain dan default/NOT NULL-nya; CHECK dan default `role`/`jenis_usaha`; trigger tambahan pada `tenants`/`user_profiles`; grant/ACL tabel dan fungsi (anon, authenticated, service_role); baris tambahan yang dibuat `handle_new_user` (mis. `business_template`); UPDATE policy `tenants` (`public` vs `authenticated`); perilaku saat user dihapus (cascade ke `tenants`?).

### 7.3 Risiko shim dan dampak pada tes real E2E
| ID | Risiko | Dampak | Koreksi |
|---|---|---|---|
| **P0** | Tidak ada P0 yang terbukti: semua akses alur ke objek UMKMpro (7.1) terpenuhi shim | tidak ada | Tidak ada |
| **P1 R1** | Proyek Supabase baru bisa tanpa grant otomatis pada tabel baru; kode butuh `authenticated` SELECT `tenants`/`user_profiles` dan EXECUTE `fn_current_*` | **FALSE FAIL**: sesi QA `permission denied` / `/session-error` padahal produksi normal | **DITERAPKAN** (bagian "TAMBAHAN KHUSUS QA-2" di `qa/qa2-shim.sql`; verifikasi `authenticated_access` di bundel; tes baru) |
| **P1 R2** | Shim hanya membuat tenants + user_profiles; `handle_new_user` produksi membuat objek lain (mis. `business_template`) | **FALSE PASS** untuk apa pun yang kelak membaca objek itu; tidak memengaruhi alur 8 langkah saat ini | DIUSULKAN: tes real E2E tidak boleh mengklaim kesetaraan `handle_new_user`; tambah jalur produksi-baca-saja untuk memverifikasi (butuh persetujuan terpisah, bukan di PR ini) |
| **P1 R3** | Role pendaftar produksi tidak terbukti dari kode; shim memakai `owner` (lihat 7.5). Bila produksi memberi role lain, form paket/pengaturan produksi tersembunyi atau ditolak RLS | **FALSE PASS** di QA | **DIPERTAHANKAN** `owner` (inferensi, bukan bukti); UNKNOWN + kueri baca-saja untuk Founder di 7.5; tes menjaga asumsi |
| P2 R4 | Hapus user QA menghapus `user_profiles` (FK cascade) tetapi `tenants` yatim tertinggal beserta baris `prompter_*`; produksi UNKNOWN | tiap run membuat tenant baru (trial segar); data lama menumpuk | **DITERAPKAN (alat)**: `scripts/qa/print-qa-reset-sql.mjs` + langkah di bagian 6 (tidak menambah trigger di shim) |
| P2 R5 | UPDATE tenants `to authenticated` (shim) vs `to public` (snapshot) | tidak teruji alur | catat saja |
| P2 R6 | Tidak ada policy UPDATE/INSERT `user_profiles`, tidak ada kolom lain | tes yang mengubah profil/tenant gagal di QA | tidak perlu bagi alur ini |
| P2 R7 | CI QA-1 tidak punya tes RLS lintas tenant | isolasi tenant tidak terbukti | **DITERAPKAN**: tes statis kebijakan RLS + `qa/qa2-rls-cross-tenant.sql` (belum dijalankan; lihat 7.7) |
| **P1 R8** | FK `auth.users` tanpa ON DELETE (audit log, approvals, connected_accounts, automation_settings) menghalangi Admin API `deleteUser` pada identitas QA yang sudah onboarding | **FALSE FAIL** pada run kedua (reset orkestrator macet) | **DITERAPKAN**: trigger khusus QA di shim (7.8) + tes |
| **P1 R9** | Orkestrator membaca `trial_ends_at`; skema hanya `current_period_end` | **FALSE FAIL** ("trial_ends_at tidak valid") bila admin client tidak memetakan | Kontrak di 7.8; tes menjaga; implementasi admin client di luar PR ini |

### 7.4 Koreksi yang diterapkan (diff ringkas)
```diff
 qa/qa2-shim.sql  (setelah trigger qa_on_auth_user_created)
+-- TAMBAHAN KHUSUS QA-2 (bukan di shim CI QA-1) -- terbukti dari kode
+grant select on public.tenants, public.user_profiles to authenticated;
+grant execute on function public.fn_current_tenant_id() to authenticated;
+grant execute on function public.fn_current_role() to authenticated;
 scripts/qa/build-schema-bundle.mjs  (baris verifikasi akhir)
+  shim_policies    = count(pg_policies tenants/user_profiles)  -- harapan 3
+  authenticated_access = has_table_privilege/has_function_privilege  -- harapan true
```
Shim tetap identik dengan shim CI QA-1 untuk semua objek bersama dan `handle_new_user`; hanya blok grant di atas yang berbeda (sengaja, bertanda, dan tes penjaga memeriksa kedua sisi). Pada Supabase lokal CI grant ini tidak mengubah hasil (default sudah ada).

### 7.5 Role default pendaftar: apa yang diharapkan aplikasi
Aplikasi tidak pernah menetapkan role; role datang dari `handle_new_user` produksi. Kebutuhan yang terbukti dari kode dan SQL:
| Aksi | Role minimum | Sumber |
|---|---|---|
| Onboarding (insert pertama `prompter_brand_profiles`), audit log, insert trial `prompter_subscriptions`, baca dashboard/billing | anggota tenant mana pun | policy INSERT/SELECT memakai hanya `fn_current_tenant_id()` |
| Form ganti paket `/billing`, `fn_set_trial_plan_preference` | `owner` | `isOwner = session.role === "owner"`; fungsi menolak bila `fn_current_role()` bukan owner |
| Upsert ulang brand profile (lewati onboarding, Settings), tulis AI jobs/atribusi/insight | `owner` atau `marketing` | policy UPDATE/ALL |
| Settings/approvals/koneksi (pemilik) | `owner` | kode halaman |
Kesimpulan: alur signup sampai trial hari-0 hanya butuh anggota tenant, jadi **kode tidak membuktikan `owner`**. Pendaftar mandiri adalah satu-satunya anggota tenant barunya, dan fitur lanjutan (paket, pengaturan) hanya bisa dipakainya bila `owner`, maka `owner` adalah inferensi terkuat tetapi **UNKNOWN**. Shim tetap `owner` (sama dengan simulasi QA-1); tes menjaga asumsi ini dan menolak role lain tanpa bukti.

Cara membuktikan (USULAN; **BACA-SAJA**, dijalankan Founder sendiri di SQL Editor dashboard UMKMpro; tidak dijalankan oleh sesi mana pun; hasil agregat tanpa data pribadi):
```sql
-- 1. Role pemilik tenant yang punya profil brand LINOE (pendaftar LINOE) -- agregat
select up.role, count(*) from public.user_profiles up
join public.prompter_brand_profiles bp on bp.tenant_id = up.tenant_id group by 1 order by 2 desc;
-- 2. Badan trigger signup dan definisi trigger pada auth.users
select pg_get_functiondef('public.handle_new_user'::regproc);
select tgname, tgenabled, pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;
-- 3. Kolom, default, CHECK, dan FK
select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
 where table_schema = 'public' and table_name in ('tenants', 'user_profiles') order by table_name, ordinal_position;
select conrelid::regclass as tabel, conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid in ('public.tenants'::regclass, 'public.user_profiles'::regclass);
-- 4. Policy dan grant
select tablename, policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public' and tablename in ('tenants', 'user_profiles');
select grantee, table_name, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and table_name in ('tenants', 'user_profiles') and grantee in ('anon', 'authenticated', 'service_role');
-- 5. Tabel template/baris tambahan yang dibuat saat signup, dan FK ke tenants yang TIDAK cascade (memengaruhi reset)
select table_name from information_schema.tables where table_schema = 'public' and table_name like '%template%';
select conrelid::regclass as tabel, conname from pg_constraint where confrelid = 'public.tenants'::regclass and contype = 'f' and confdeltype <> 'c';
```
Tempel hasilnya (tanpa email/nama pengguna) ke sesi QA agar shim bisa dikoreksi dengan bukti.

### 7.6 `handle_new_user`: kebutuhan aplikasi vs shim
| Perilaku | Dibutuhkan jalur signup/onboarding? | Shim | Status |
|---|---|---|---|
| Baris `tenants` (`nama_usaha` dari metadata, `jenis_usaha`, `email`) | Ya: `services/session.ts` membaca `tenants.nama_usaha` | Dibuat | Terbukti dari kode |
| Baris `user_profiles` (`id`=auth id, `tenant_id`, `nama`, `role`) | Ya: tanpa baris ini `/session-error` | Dibuat | Terbukti dari kode |
| Nilai `role` | Anggota cukup untuk alur; `owner` untuk fitur lanjutan | `owner` | UNKNOWN (7.5) |
| Baris `business_template` (kata komentar `features/auth/actions.ts`) | Tidak: tidak ada kode signup/onboarding/billing yang membacanya | Tidak dibuat | UNKNOWN tabelnya/efek lain; tidak memengaruhi alur |
| Langganan trial | Tidak dibuat trigger: dibuat aplikasi saat `/billing` (komentar migrasi `20261019100100`) | Tidak dibuat | Terbukti dari kode/migrasi |
| Tabel LINOE (`prompter_*`) | Tidak: dibuat onboarding/billing | Tidak dibuat | Terbukti |
Tes statis memeriksa: semua kolom yang dibaca jalur signup/onboarding ada di shim, `handle_new_user` mengisi semua kolom `NOT NULL` tanpa default, dan kunci metadata yang dikirim `signUp` dibaca fungsi.

### 7.7 Uji RLS lintas tenant
- **Statis (dijalankan di CI):** `tests/unit/qa/qa2-schema-manifest.test.ts` mem-parse kebijakan akhir (setelah drop/create berurutan) pada sembilan tabel inti (`tenants`, `user_profiles`, brand_profiles, audit_logs, subscriptions, invoices, ai_jobs, attributions, analytics_insights): RLS aktif, setiap kebijakan memuat predikat `fn_current_tenant_id()`, tidak ada `using (true)`, langganan tanpa kebijakan UPDATE, insert trial dipaksa `TRIALING`/`FREE`.
- **Eksekusi (BELUM dijalankan):** `qa/qa2-rls-cross-tenant.sql`, dijalankan Founder nanti di proyek QA setelah bundel dan dengan persetujuan terpisah. Membuat dua pengguna uji, beralih ke role `authenticated` sebagai A, memeriksa A tidak bisa membaca/menulis/mengubah data B (dengan kontrol positif dan uji anon), lalu sengaja melempar galat `QA2_RLS_RESULT ...` agar seluruh data uji dibatalkan. Hasil lulus: `QA2_RLS_RESULT ALL_PASS | fails=0`.
- Batas: ini menguji kebijakan di shim QA, bukan di produksi (policy produksi `tenants`/`user_profiles` UNKNOWN).

### 7.8 Audit akhir terhadap main 18db8c2 (orkestrator, admin client, grant)
Yang berubah di main sejak basis (#150-#153): `scripts/qa/real-e2e.mjs`, `inbox-adapter.mjs`, `real-e2e-guard.mjs`, workflow dan dokumen QA-2. Tidak ada perubahan pada `app/`, `features/`, `services/`, `lib/`, `proxy.ts`, `types/`, `supabase/`. Jadi hasil 7.1-7.7 tetap berlaku.

**Kontrak admin client orkestrator** (`deps.adminClient`; implementasi nyata belum ada di main, hanya tipe dan mock tes) vs bundel:
| Yang dipakai orkestrator | Yang ada di bundel | Catatan |
|---|---|---|
| `getTrial(email)` mengembalikan `status`, `plan`, **`trial_ends_at`** | `prompter_subscriptions.status`, `plan`, **`current_period_end`**; tidak ada kolom `trial_ends_at` di mana pun | Implementasi wajib: user -> `user_profiles.tenant_id` -> `prompter_subscriptions` lalu `trial_ends_at = current_period_end` (sama dengan yang dipakai `services/billing.ts`). Bila tidak, langkah 9 gagal "trial_ends_at tidak valid" |
| Trial 14 hari, toleransi 1 hari | trigger SQL `interval '14 days'` = `TRIAL_DURATION_DAYS` = `TRIAL_DAYS` | Konsisten (diuji) |
| `findUserByEmail`, `deleteUser` (Admin API) langkah 1 dan 11 | FK `audit_logs.actor_user_id` dll. ke `auth.users` tanpa ON DELETE | Tanpa penanganan, `deleteUser` gagal setelah onboarding. Shim: trigger `qa2_before_auth_user_delete` menghapus tenant pengguna (cascade) tepat sebelum user dihapus. Khusus QA; produksi UNKNOWN (kemungkinan pola FK yang sama) |
| Baca trial lewat service_role (PostgREST) | `service_role` perlu SELECT pada `user_profiles`, `prompter_subscriptions` | Shim memberi SELECT `tenants`/`user_profiles`; tabel `prompter_*` bergantung pada default grant (diperiksa `service_role_access`) |

**Grant/ACL dan Data API proyek baru.** Migrasi memakai `revoke`/`grant update (plan)` yang mengandaikan grant default Supabase (anon/authenticated/service_role mendapat hak pada tabel baru di `public` bila "Data API" aktif dan auto-expose menyala). Itu UNKNOWN untuk proyek QA. Bila tidak menyala: `authenticated` ditolak pada tabel `prompter_*` (false fail). Bundel TIDAK menambah grant pada tabel `prompter_*` (tidak terbukti perlu; menambahnya mengubah ACL migrasi); ia hanya memverifikasi (`app_table_grants`). "Automatic RLS": semua tabel shim dan migrasi mengaktifkan RLS sendiri, jadi aman bila opsi itu menyala.

**Role di jalur signup, onboarding 8 langkah, trial hari-0:** tidak ada pemeriksaan role sampai trial dibuat; pemeriksaan role pertama ada di form paket `/billing` (`owner`). Detail 7.5. **RLS lintas tenant** dan **trigger trial/guard 14 hari**: tidak berubah (7.7; trigger `trg_prompter_subscriptions_enforce_trial_insert` ada di bundel dan dicek `trial_trigger=O`).

## 8. UNKNOWN (belum dibuktikan)
| Hal | Status |
|---|---|
| Subset 15 migrasi + shim benar-benar berjalan mulus di Postgres | **UNKNOWN**: tidak dijalankan di database mana pun. Bukti hanya statis. CI QA-1 menerapkan SEMUA 50 migrasi, bukan subset ini. Saran: job CI lokal yang menerapkan bundel ke Postgres sementara sebelum Founder menempel |
| Batas ukuran tempel SQL Editor di HP (potongan 50-85 KB; satu berkas 165 KB) | UNKNOWN |
| Transaksi eksplisit `begin`/`commit` di SQL Editor dan trigger pada `auth.users` oleh role editor | UNKNOWN (umumnya didukung) |
| Grant/ACL default tabel di proyek QA vs produksi | UNKNOWN |
| Admin client QA nyata (pemetaan `trial_ends_at`, reset) belum ada di main | UNKNOWN; hanya kontrak yang diaudit |
| Trigger `qa2_before_auth_user_delete` bekerja pada `auth.users` hosted dan dengan Admin API | UNKNOWN: tidak dijalankan |
| Role default pendaftar, isi `handle_new_user`, kolom/CHECK/policy produksi | UNKNOWN (kueri baca-saja di 7.5) |
| `qa/qa2-rls-cross-tenant.sql` dan `print-qa-reset-sql.mjs` hasil SQL-nya | UNKNOWN: tidak dijalankan di database mana pun (insert minimal ke `auth.users`, perilaku `DELETE` cascade) |
| Bukan skema, tetap harus disiapkan terpisah (di luar PR ini) | Template email konfirmasi (`/auth/confirm`), Site URL/Redirect URL, SMTP Resend; `ADMIN_CENTER_ENABLED` tidak diisi |

Tidak mengaktifkan QA-2: `QA2_ENABLED` dan `QA2_ACTIVATED` tidak disentuh.
