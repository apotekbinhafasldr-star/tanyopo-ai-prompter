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

## 5. Cara paling sederhana dari HP: satu berkas .sql
Skrip `scripts/qa/build-schema-bundle.mjs` (node murni, tanpa dependensi, tidak terhubung ke database mana pun) menggabungkan shim + 15 migrasi menjadi **satu berkas** (sekitar 165 KB, satu transaksi: semua atau tidak sama sekali).
```
node scripts/qa/build-schema-bundle.mjs --out /path/di/luar/repo/qa2-schema-bundle.sql   # atau > bundle.sql
node scripts/qa/build-schema-bundle.mjs --check                                          # validasi saja
```
Langkah Founder (Android Chrome, mode "Situs desktop" bila perlu), **setelah** menulis `APPROVE QA-2-SCHEMA-BUNDLE`:
1. Sesi Claude membangun berkas dan membagikannya (mis. tautan/Drive). Buka di HP, pilih semua, salin.
2. Dashboard Supabase, buka proyek dengan ref **gasdqsadnjoknisloaec** (cek di URL; header berkas juga berisi `HANYA UNTUK PROYEK QA gasdqsadnjoknisloaec`). Jangan lanjut bila ref berbeda.
3. SQL Editor, query baru, tempel seluruh isi, klik Run. Konfirmasi peringatan "destructive" jika muncul (berasal dari `drop trigger/policy if exists` dan `revoke` di migrasi).
4. Hasil terakhir harus: `migrations_applied=15`, `trial_trigger=O`, `free_plan_active=1`, `signup_trigger=1`.
5. Jika gagal: tidak ada yang tersimpan (satu transaksi). Kirim pesan galatnya; jangan edit manual.

## 6. Rollback
Tidak ada rollback per-migrasi. Proyek QA terpisah dari produksi, jadi rollback = **hapus lalu buat ulang proyek QA** (ref baru harus diganti di allowlist lewat PR kecil tersendiri), lalu terapkan ulang bundel. Guard "proyek kosong" menolak menjalankan bundel dua kali.

## 7. UNKNOWN (belum dibuktikan)
| Hal | Status |
|---|---|
| Subset 15 migrasi + shim benar-benar berjalan mulus di Postgres | **UNKNOWN**: tidak dijalankan di database mana pun. Bukti hanya statis. CI QA-1 menerapkan SEMUA 50 migrasi, bukan subset ini. Saran: job CI lokal yang menerapkan bundel ke Postgres sementara sebelum Founder menempel |
| Batas ukuran tempel SQL Editor di HP (165 KB) | UNKNOWN |
| Transaksi eksplisit `begin`/`commit` di SQL Editor dan trigger pada `auth.users` oleh role editor | UNKNOWN (umumnya didukung) |
| Grant/ACL default tabel di proyek QA vs produksi | UNKNOWN |
| Bukan skema, tetap harus disiapkan terpisah (di luar PR ini) | Template email konfirmasi (`/auth/confirm`), Site URL/Redirect URL, SMTP Resend; `ADMIN_CENTER_ENABLED` tidak diisi |

Tidak mengaktifkan QA-2: `QA2_ENABLED` dan `QA2_ACTIVATED` tidak disentuh.
