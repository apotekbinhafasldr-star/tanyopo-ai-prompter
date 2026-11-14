# QA-2: skema minimum proyek Supabase QA

**Status: NOT APPLIED.** Hanya manifest, shim, skrip pembangun, dan tes. Tidak ada SQL yang dijalankan di database mana pun, tidak ada perubahan Supabase/Resend/DNS/Netlify/secret.

**HANYA UNTUK PROYEK QA gasdqsadnjoknisloaec** (`linoe-qa-real-email`, masih kosong). Jangan pernah ke `umkmpro-ai` (proyek bersama UMKMpro) atau proyek lain.

Sumber kebenaran: [`qa/qa2-schema-manifest.json`](../qa/qa2-schema-manifest.json). Dasar: `origin/main` fba8167.

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
Skrip `scripts/qa/build-schema-bundle.mjs` (node murni, tanpa dependensi, tidak terhubung ke database mana pun) menggabungkan shim + 15 migrasi. Satu berkas = **166 KB**, di atas batas nyaman tempel dari HP (100 KB), jadi pakai `--parts`. Urutan migrasi **tidak berubah**; pemisahan hanya di batas migrasi.
```
node scripts/qa/build-schema-bundle.mjs --out /path/di/luar/repo/qa2.sql                # 1 berkas, 166 KB, satu transaksi
node scripts/qa/build-schema-bundle.mjs --out /path/di/luar/repo/qa2.sql --parts 3      # disarankan untuk HP
node scripts/qa/build-schema-bundle.mjs --check                                         # validasi saja
```
| Mode | Berkas | Ukuran | Isi |
|---|---|---|---|
| 1 berkas | `qa2.sql` | 166 KB | semua, atomik penuh |
| `--parts 2` | part1of2 / part2of2 | 85 / 84 KB | shim..`phase7` / `billing_foundation`..`lockdown` |
| `--parts 3` (disarankan) | part1of3 / 2of3 / 3of3 | 61 / 45 / 65 KB | shim..`phase3` / `phase5`..`starter_plan` / `b9`..`lockdown` |

Aturan potongan: jalankan **berurutan** 1, 2, 3. Tiap potongan atomik (satu transaksi) dan menolak jalan bila potongan sebelumnya belum ada atau dirinya sudah diterapkan (guard versi di `_linoe_sandbox_applied`). Bila satu potongan gagal, isinya tidak tersimpan, potongan sebelumnya tetap; kirim galatnya (rollback tetap = hapus dan buat ulang proyek). Hanya potongan terakhir yang menutup dengan baris verifikasi.

Langkah Founder (Android Chrome, mode "Situs desktop" bila perlu), **setelah** menulis `APPROVE QA-2-SCHEMA-BUNDLE`:
1. Sesi Claude membangun berkas dan membagikannya (mis. tautan/Drive). Buka satu potongan di HP, pilih semua, salin.
2. Dashboard Supabase, buka proyek dengan ref **gasdqsadnjoknisloaec** (cek di URL; header tiap potongan berisi `HANYA UNTUK PROYEK QA gasdqsadnjoknisloaec`). Jangan lanjut bila ref berbeda.
3. SQL Editor, query baru, tempel, Run. Konfirmasi peringatan "destructive" bila muncul (dari `drop trigger/policy if exists` dan `revoke` di migrasi). Ulangi untuk potongan berikutnya.
4. Hasil potongan terakhir harus: `migrations_applied=15`, `trial_trigger=O`, `free_plan_active=1`, `signup_trigger=1`, `shim_policies=3`, `authenticated_access=true`.

## 6. Rollback
Tidak ada rollback per-migrasi. Proyek QA terpisah dari produksi, jadi rollback = **hapus lalu buat ulang proyek QA** (ref baru harus diganti di allowlist lewat PR kecil tersendiri), lalu terapkan ulang bundel. Guard "proyek kosong" menolak menjalankan bundel dua kali.

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
| **P1 R3** | Role pendaftar produksi tidak diketahui; shim selalu `owner`. Bila produksi memberi role lain, onboarding/billing produksi ditolak RLS atau form paket tersembunyi | **FALSE PASS** di QA | DIUSULKAN: bukti dari Founder/UMKMpro (nilai default role di produksi), lalu ubah `handle_new_user` di shim. Tidak diubah karena tidak terbukti dari kode; sim QA-1 juga `owner` |
| P2 R4 | Hapus user QA (reset Admin API) menghapus `user_profiles` (FK cascade) tetapi `tenants` yatim tertinggal, beserta baris `prompter_*`; produksi UNKNOWN | tiap run membuat tenant baru (trial segar); data lama menumpuk. Tes "trial tidak bisa diulang per tenant" tidak mewakili anti-abuse per email | DIUSULKAN: reset QA menghapus `tenants` milik user lebih dulu (tenants cascade ke seluruh `prompter_*`); jangan menambah trigger di shim yang tidak ada di produksi |
| P2 R5 | UPDATE tenants `to authenticated` (shim) vs `to public` (snapshot) | tidak teruji alur | catat saja |
| P2 R6 | Tidak ada policy UPDATE/INSERT `user_profiles`, tidak ada kolom lain | tes yang mengubah profil/tenant gagal di QA | tidak perlu bagi alur ini |
| P2 R7 | CI QA-1 tidak punya tes RLS lintas tenant | isolasi tenant tidak terbukti | DIUSULKAN: satu tes SQL lokal CI dengan dua tenant shim (di luar file milik PR ini) |

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

## 8. UNKNOWN (belum dibuktikan)
| Hal | Status |
|---|---|
| Subset 15 migrasi + shim benar-benar berjalan mulus di Postgres | **UNKNOWN**: tidak dijalankan di database mana pun. Bukti hanya statis. CI QA-1 menerapkan SEMUA 50 migrasi, bukan subset ini. Saran: job CI lokal yang menerapkan bundel ke Postgres sementara sebelum Founder menempel |
| Batas ukuran tempel SQL Editor di HP (potongan 45-85 KB; satu berkas 166 KB) | UNKNOWN |
| Transaksi eksplisit `begin`/`commit` di SQL Editor dan trigger pada `auth.users` oleh role editor | UNKNOWN (umumnya didukung) |
| Grant/ACL default tabel di proyek QA vs produksi | UNKNOWN |
| Bukan skema, tetap harus disiapkan terpisah (di luar PR ini) | Template email konfirmasi (`/auth/confirm`), Site URL/Redirect URL, SMTP Resend; `ADMIN_CENTER_ENABLED` tidak diisi |

Tidak mengaktifkan QA-2: `QA2_ENABLED` dan `QA2_ACTIVATED` tidak disentuh.
