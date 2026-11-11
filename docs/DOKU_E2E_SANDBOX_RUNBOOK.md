# Runbook E2E Sandbox DOKU dan Kesiapan Pembayaran

Dokumen ini hanya dokumen. Tidak mengubah kode pembayaran, migrasi, env, Netlify, Supabase, atau `PAYMENT_LIVE_ENABLED` (tetap kosong/OFF).
Semua langkah bisa dikerjakan dari HP Android (Chrome, aktifkan "Situs desktop" bila menu tidak terlihat) lewat dashboard Netlify,
Supabase, DOKU Back Office, dan GitHub Actions. Tidak ada langkah yang butuh laptop atau CLI lokal.

Tanggal audit kode dan dokumentasi: 2026-11-11 (basis `main` setelah PR #113).

## 0. Status berlabel (jujur)

| Area | Label saat ini | Dasar |
|---|---|---|
| Adapter DOKU, webhook, verifikasi, alert | UNIT TEST PASS, MOCK E2E PASS | CI `main` hijau; tes memakai gateway tiruan (`tests/unit/**/doku*`, `payment-webhook-doku.test.ts`) |
| Skema DB sandbox T6..T17 (termasuk migrasi P0-3) | SANDBOX DB PASS | runner `DOKU Sandbox Runner` run #4 dan #5 sukses; ini uji skema/fungsi DB, BUKAN pembayaran |
| Pembayaran sandbox nyata (checkout, simulator, webhook DOKU asli) | BELUM ADA. Tidak ada label SANDBOX E2E PASS | belum pernah dijalankan |
| Pembayaran nyata / live | REAL E2E: tidak ada. CUSTOMER READY: tidak | KYB DOKU belum selesai; kode live DOKU tidak ada |

Aturan label: hasil tiruan tidak boleh ditulis sebagai E2E. SANDBOX E2E PASS hanya boleh ditulis per skenario/per channel
setelah bukti di bagian 7 terisi.

## 1. Siapa mengerjakan apa

| Kolom | Isi |
|---|---|
| Bisa dikode (Claude, PR terpisah, perlu review) | Gap P0/P1 bagian 9: penanda event UNKNOWN, kartu kesehatan webhook di `/ops/payments`, aksi verifikasi ulang operator, kolom rekonsiliasi, catat refund/chargeback manual, capture channel. Rancangan migrasi (hanya rancangan) |
| Butuh Founder | Membuat situs Netlify sandbox + isi env (nilai rahasia hanya di dashboard), membuat 2 user uji di Supabase sandbox, mengisi Notification URL di Back Office DOKU sandbox, menjalankan pembayaran lewat simulator, menjalankan query baca-saja dan mengisi tabel bukti, menyetujui PR #114 sebelum dipakai sebagai bukti, keputusan B-CUR, persetujuan tertulis sebelum membahas live |
| Butuh DOKU (EXTERNAL BLOCKED) | Perbaikan kode pos merchant (belum ada konfirmasi), KYB disetujui, aktivasi channel produksi, konfirmasi apakah Check Status VA/QRIS/e-wallet mengirim `order.currency`, ketersediaan refund/chargeback/settlement di sandbox, daftar dokumen per badan usaha |

## 2. Prasyarat (centang sebelum mulai)

- [ ] PR #112 dan #113 sudah merged (benar per checkpoint). Runner T15..T17 PASS (run #4, #5).
- [ ] Migrasi P0-3 hanya terpasang di `linoe-doku-sandbox`; produksi (`umkmpro-ai`) belum disentuh. Jangan diubah oleh runbook ini.
- [ ] PR #114 (Draft: kode alasan penolakan verifikasi DOKU) dibahas di bagian 7.1. Tanpa #114 terdeploy di situs sandbox, bukti B-CUR tidak sah.
- [ ] Founder sudah bisa login portal DOKU (akun ada). Yang dibutuhkan dari portal: Client ID dan Secret Key **sandbox**, serta halaman Notification URL.
- [ ] `PAYMENT_LIVE_ENABLED` kosong di semua situs. Jangan diisi untuk uji apa pun: nilai apa pun mematikan adapter DOKU (`resolveDokuConfig`).
- [ ] Wadah rahasia: pengelola kata sandi di HP. Tidak ada kata sandi, Secret Key, atau service key yang ditulis ke chat, issue, PR, atau log Actions (repo ini PUBLIK).
- [ ] Kendala eksternal diketahui: kode pos merchant sedang diperbaiki DOKU. Ini tidak menghalangi uji sandbox, tetapi menghalangi KYB dan live.
- Tidak terverifikasi: apakah semua channel (VA, QRIS, e-wallet, kartu) tersedia penuh di akun sandbox sebelum KYB. Dokumen DOKU hanya menyebut akun baru mulai di mode sandbox. Catat channel yang ternyata tidak tersedia sebagai "tidak bisa dibuktikan di sandbox".

## 3. Situs Netlify SANDBOX terisolasi

Tujuan: satu situs Netlify KHUSUS sandbox, terhubung ke database sandbox saja. Situs produksi tidak disentuh sama sekali.

### 3.1 Larangan keras
1. Jangan memasang env DOKU atau env sandbox di situs produksi. Jangan memakai Deploy Preview atau Branch Deploy situs produksi.
2. Jangan menyalin/mengimpor env dari situs produksi saat membuat situs baru. Isi satu per satu.
3. Periksa env bersama tingkat tim (Team settings, Environment variables). Bila ada variabel bersama yang berisi URL/kunci Supabase produksi
   atau kunci pembayaran, batasi scope-nya agar tidak berlaku di situs sandbox sebelum deploy pertama.
4. Jangan isi `PAYMENT_LIVE_ENABLED`, `PREVIEW_BASIC_AUTH_USER`, `PREVIEW_BASIC_AUTH_PASSWORD`, `CHECKOUT_ALLOWED_ORIGINS`.
5. Jangan mengarahkan Notification URL produksi atau domain produksi ke situs ini, dan sebaliknya.
6. Lapisan terakhir: kode menolak sendiri bila database yang dituju adalah `umkmpro-ai` atau tidak ada di daftar izin (guard P1-C,
   `lib/billing/providers/doku-sandbox-db-guard.ts`). Guard bukan alasan untuk longgar pada lima butir di atas.

### 3.2 Pembuatan situs (dashboard Netlify)
1. Add new site, Import an existing project, GitHub, repo ini. Branch `main`. Perintah build sudah di `netlify.toml`.
2. Isi env pada langkah konfigurasi SEBELUM deploy pertama (bila tidak ada, deploy pertama boleh gagal, lalu isi env dan deploy ulang).
3. Variabel berawalan `NEXT_PUBLIC_` ditanam saat build. Setiap perubahan nilainya butuh deploy ulang (Trigger deploy, Clear cache and deploy).
4. Deploy context: pakai konteks Production milik situs sandbox ini saja. Pertimbangkan "Stop auto publishing" agar kode baru dari `main`
   masuk ke sandbox hanya saat Founder memilih Publish deploy. Label menu Netlify bisa berubah; tidak diverifikasi di sesi ini.
5. Visitor access: biarkan TANPA Team Login/Password protection. DOKU tidak bisa mengirim notifikasi ke URL yang dilindungi autentikasi
   (dokumentasi DOKU, lihat bagian 8 dan 11). Situs ini hanya berisi data dummy.
6. Catat URL situs sandbox (`https://<nama>.netlify.app`). URL itulah `NEXT_PUBLIC_APP_URL`.

### 3.3 Nama variabel env (TANPA nilai)

Wajib di situs sandbox:

| Variabel | Rahasia? | Keterangan |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | tidak | URL project `linoe-doku-sandbox` (bentuk standar `https://<ref>.supabase.co`; domain kustom ditolak guard) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | tidak | kunci publishable project sandbox |
| `SUPABASE_SECRET_KEY` | YA | service key project sandbox. Hanya di dashboard Netlify, tandai "contains secret value"; scope harus mencakup runtime/Functions |
| `NEXT_PUBLIC_APP_URL` | tidak | URL situs sandbox (https), dipakai sebagai alamat kembali checkout |
| `PAYMENT_PROVIDER_NAME` | tidak | `doku` |
| `PAYMENT_PROVIDER_ENV` | tidak | `sandbox` (harus persis) |
| `PAYMENT_PROVIDER_CLIENT_ID` | tidak (tetap server-side) | Client ID SANDBOX |
| `PAYMENT_PROVIDER_API_KEY` | YA | Secret Key SANDBOX |
| `PAYMENT_SANDBOX_DB_PROJECT_REFS` | tidak | daftar izin berisi tepat ref project sandbox (ref ada di `supabase/sandbox/doku/RUNNER.md`); tidak boleh memuat ref produksi |

Harus KOSONG/TIDAK ADA di situs sandbox (selain tahap opsional di 5.4):
`PAYMENT_LIVE_ENABLED`, `PAYMENT_SWEEPER_ENABLED`, `PAYMENT_SWEEPER_SECRET`, `ALERT_EMAIL_ENABLED`, `PREVIEW_BASIC_AUTH_USER`,
`PREVIEW_BASIC_AUTH_PASSWORD`, `CHECKOUT_ALLOWED_ORIGINS`, `PAYMENT_PROVIDER_WEBHOOK_SECRET` (tidak dipakai DOKU),
`UMKMPRO_SERVICE_TOKEN`, `META_*`, `TIKTOK_*`, `X_*`, `TOKEN_ENCRYPTION_KEY`, `JOBS_PROCESSOR_SECRET`.

### 3.4 Verifikasi isolasi (wajib sebelum uji pembayaran)
- [ ] Buka `<situs sandbox>/api/health`: `{"status":"ok"}`.
- [ ] Di Netlify situs PRODUKSI: tidak ada variabel `PAYMENT_PROVIDER_ENV`, `PAYMENT_PROVIDER_CLIENT_ID`, `PAYMENT_SANDBOX_DB_PROJECT_REFS` (hanya dilihat, tidak diubah).
- [ ] Di Supabase: ref pada `NEXT_PUBLIC_SUPABASE_URL` situs sandbox sama dengan ref di URL dashboard `linoe-doku-sandbox`.
- [ ] Supabase sandbox, Authentication, URL Configuration: Site URL = URL situs sandbox.
- [ ] Back Office DOKU diset ke akun/mode SANDBOX saat mengambil Client ID dan Secret Key.

### 3.5 Notification URL di Back Office DOKU (sandbox)
Dokumentasi DOKU: Notification URL diisi per channel (Settings, Payment Settings, pilih VA / e-Wallet / dst, tombol CONFIGURE); untuk Kartu
ada satu kolom di tab Payment Configuration. Isi SEMUA channel yang akan diuji dengan path persis (tanpa query):

```
https://<situs sandbox>/api/webhooks/payment
```
Kode menolak path ber-`?` atau `#`, dan menolak notifikasi yang tanda tangannya dihitung atas path lain. URL harus publik, tanpa autentikasi, tanpa VPN, port normal.
Tidak terverifikasi: apakah halaman ini berbeda antara sandbox dan produksi (dokumen DOKU diam).

## 4. Supabase Auth sandbox: dua tenant uji tanpa kata sandi di chat

Fakta kode: user seed `seed-a@sandbox.invalid` dan `seed-b@sandbox.invalid` TIDAK bisa login. Trigger `handle_new_user` TIDAK terpasang di sandbox
(`01_shim_shared_objects.sql`), jadi mendaftar lewat halaman `/register` hanya membuat user Auth tanpa tenant/profil, lalu `/session-error`. Karena itu tenant dibuat
dengan SQL di bawah, setelah user dibuat di dashboard.

Langkah (semua di dashboard Supabase project `linoe-doku-sandbox`, cek ref di URL):
1. Authentication, Users, Add user, Create new user. Buat 2 user (A dan B). Email: alamat milik Founder (alias boleh). Kata sandi: dibuat oleh pengelola
   kata sandi dan diketik langsung di formulir dashboard. Centang Auto Confirm User. Tidak ada kata sandi yang dikirim ke chat/PR/log.
   Label menu bisa berubah; tidak diverifikasi.
2. SQL Editor, jalankan blok berikut setelah mengganti dua placeholder email DI EDITOR (bukan di chat). Idempoten. Ditulis mengikuti `20_seed_dummy.sql`;
   belum dijalankan oleh penulis dokumen ini, jadi bila ada galat, hentikan dan laporkan pesan galatnya tanpa mengubah SQL secara bebas.

```sql
-- HANYA project sandbox. Ganti GANTI_EMAIL_A dan GANTI_EMAIL_B di editor.
do $e2e$
declare r record; v_uid uuid; v_tid uuid;
begin
  if to_regclass('public._linoe_sandbox_marker') is null then
    raise exception 'ABORT: bukan project sandbox';
  end if;
  for r in select * from (values ('GANTI_EMAIL_A', 'E2E Tenant A'), ('GANTI_EMAIL_B', 'E2E Tenant B')) as t(email, usaha) loop
    select id into v_uid from auth.users where lower(email) = lower(r.email);
    if v_uid is null then raise exception 'ABORT: user Auth belum dibuat'; end if;
    if exists (select 1 from public.user_profiles where id = v_uid) then continue; end if;
    v_tid := gen_random_uuid();
    insert into public.tenants (id, nama_usaha) values (v_tid, r.usaha);
    insert into public.user_profiles (id, tenant_id, nama, role) values (v_uid, v_tid, r.usaha, 'owner');
    insert into public.prompter_subscriptions (tenant_id, plan, status, current_period_start, current_period_end, billing_provider)
    values (v_tid, 'FREE', 'TRIALING', now() - interval '1 day', now() + interval '13 days', null);
  end loop;
end $e2e$;
```
3. Jadikan user A operator pembayaran (agar `/ops/payments` bisa dibuka; tabel allowlist, hanya service_role). Ganti placeholder di editor:
```sql
insert into public.prompter_payment_operators (user_id, label, created_by)
select id, 'E2E operator', 'founder' from auth.users where lower(email) = lower('GANTI_EMAIL_A')
on conflict (user_id) do nothing;
```
4. Login ke situs sandbox sebagai A dan B (dua profil/jendela penyamaran berbeda). Selesaikan `/onboarding` untuk masing-masing
   (halaman `/billing` mewajibkan onboarding selesai).
5. Peringatan runner: runner `DOKU Sandbox Runner` membandingkan keadaan DB dengan `golden_state.txt`. Setelah SQL ini dan transaksi uji,
   jangan jalankan ulang runner (preflight akan berhenti karena selisih). Bila runner harus dijalankan lagi, reset data uji dulu atau buat ulang project sandbox.
   Rancangan lebih bersih (berkas seed E2E di runner) ada di gap P1-K bagian 9.

## 5. Skenario E2E

Aturan umum: paket termurah berbayar (99.000, harga katalog `lib/billing/plans.ts`) untuk A dan B. Pembayaran hanya lewat simulator sandbox DOKU
(`https://sandbox.doku.com/integration/simulator/`; checkout dimulai dari halaman `/billing`). Jangan memakai kartu atau rekening asli. Tunggu minimal 60 detik
setelah bayar sebelum menyimpulkan (dokumen DOKU: Check Status baru andal setelah 60 detik). Catat tiap hasil di tabel bukti (bagian 7).

Kolom "Sudah dicakup tes" = perilaku sudah UNIT TEST PASS dengan gateway tiruan, jadi E2E hanya perlu membuktikan hal yang tiruan tidak bisa buktikan.

### 5.1 Daftar skenario

| ID | Skenario | Langkah ringkas (HP) | Hasil yang diharapkan | Sudah dicakup tes |
|---|---|---|---|---|
| S0 | Pra-cek | bagian 3.4 selesai; A login, buka `/billing`, tekan beli paket termurah | diarahkan ke halaman bayar di domain DOKU (catat HANYA nama domainnya: bukti A9); bila ditolak aplikasi, kode alasan di pesan jujur | `checkout-doku.test.ts` |
| S1 | Checkout VA | A, pilih VA (bila tersedia), bayar di simulator | txn PENDING lalu PAID; langganan A ACTIVE satu periode; 1 invoice PAID; event `PROCESSED`. ATAU `FAILED` dengan kode alasan (bagian 7, B-CUR) | adapter + webhook |
| S2 | QRIS | idem, pilih QRIS | idem | idem |
| S3 | E-wallet | idem, pilih e-wallet yang tersedia di sandbox; catat nama channel | idem | idem |
| S4 | Kartu | idem, kartu uji dari simulator/dokumentasi kartu DOKU (bukan kartu asli); catat kata `transaction.type` yang muncul (SALE/AUTHORIZE/...): bukti A13 | `SALE`/`CAPTURE` jadi PAID; `AUTHORIZE`/lain jadi UNKNOWN (tidak aktif, event `VERIFIED_STATUS_UNKNOWN`) | `mapDokuStatus` |
| S5 | Webhook valid | otomatis di S1-S4; cek event DOKU `source_system='doku'` | satu baris event per notifikasi, status `PROCESSED` untuk bayar sukses | webhook DOKU |
| S6 | Replay | Back Office, Integration, HTTP Notification, cari notifikasi, ikon kirim ulang. Ulangi 2 kali | jawaban "Already processed", periode tidak bertambah, invoice tetap 1. Catat: apakah kirim ulang membuat baris event baru (Request-Id baru) atau tidak: bukti A8 | replay guard |
| S7 | Idempoten | tekan beli 2 kali cepat (B2); kirim ulang notifikasi | satu invoice terbuka per tenant; `current_period_end` tidak maju lagi | B2, webhook |
| S8 | Check Status satu-satunya sumber aktivasi | (a) kosongkan sementara Notification URL channel itu di Back Office sandbox, bayar, buka `/billing?txn=<id>` | aktivasi terjadi lewat perjalanan kembali (server bertanya ke DOKU), bukan lewat notifikasi; txn PAID dengan nominal dari DOKU. (b) tanpa kembali ke situs dan tanpa notifikasi: txn tetap PENDING (celah, lihat P0-C) | `payment-reconciliation*.test.ts` |
| S9 | Kedaluwarsa | buat checkout, JANGAN bayar. Batas bayar 24 jam (kode); periksa lagi setelah lewat | txn EXPIRED (menutup invoice PENDING saja); bila dibayar sesudah ditutup (tautan pemulihan DOKU): REVIEW + alert, tidak aktif. Catat kata `order.status` (mis. `ORDER_EXPIRED`, `ORDER_RECOVERED`) | webhook, B2 |
| S10 | Refund | kartu: via mekanisme refund kartu DOKU bila ada di sandbox. VA/non-kartu: manual (bagian 6.1). Cek `/ops/payments` | bila DOKU melaporkannya: alert REFUND, langganan TIDAK berubah. Bila sandbox tak bisa refund: tandai BLOCKED/EXTERNAL | alarm refund |
| S11 | Settlement | Back Office, Reports, Settlements (jika ada data di sandbox) | catat apakah sandbox punya laporan settlement. Bila tidak: bukti tertunda sampai produksi (syarat live) | tidak ada kode |
| S12 | Rekonsiliasi | A (operator): `/ops/payments`, kartu Ekspor rekonsiliasi, rentang hari uji | tiap PAID punya `check=OK`. Cocokkan jumlah dan waktu dengan laporan transaksi Back Office DOKU (lihat celah P1-E: kolom nomor invoice DOKU belum ada) | `reconciliation-csv` |
| S13 | Invoice | A, `/billing` | tepat 1 invoice PAID per transaksi PAID; tanpa penomoran resmi dan tanpa klaim pajak (keputusan D1 tertunda) | P0-2 |
| S14 | Chargeback | tidak bisa disimulasikan di sandbox (belum terverifikasi); hanya proses (6.2) | tidak ada alert otomatis dari DOKU yang terdokumentasi. Tandai BLOCKED/EXTERNAL dan lihat P1-F | alarm CHARGEBACK (hanya jalur Midtrans-style) |
| S15 | Isolasi tenant | B login; buka `/billing?txn=<id transaksi A>`; lihat daftar invoice B; buka `/ops/payments` sebagai B | NOT_FOUND untuk txn A; tidak ada invoice A; `/ops/payments` 404 untuk non-operator. Notifikasi untuk txn A tidak mengubah langganan B (cek Q-D) | RLS + webhook DOKU |

Hal yang sengaja tidak diuji ulang karena sudah PASS di unit/CI: tanda tangan salah/badan diubah/header hilang/Client-Id asing (401), batas ukuran
badan, `invoice_number` bukan milik kita (400), provider berbeda (WRONG_PROVIDER), guard DB produksi (503), pemetaan status, mata uang non-IDR.
Pengujian negatif ini tidak bisa dilakukan dari HP tanpa membuat tanda tangan, jadi jangan diulang secara manual (rancangan opsional di P2-M).

### 5.2 Urutan yang disarankan
1. S0. 2. Mulai S9 lebih awal (butuh menunggu). 3. S1, S2, S3, S4 (satu per satu, catat bukti sebelum lanjut). 4. S6, S7. 5. S8.
6. S10, S12, S13, S15. 7. S11, S14 (kemungkinan BLOCKED/EXTERNAL).

### 5.3 Pemulihan bila pembayaran sudah masuk tetapi langganan belum aktif
Penyebab umum: webhook dijawab 503 (B-CUR, DOKU belum konsisten, gangguan). DOKU hanya mencoba ulang 3 kali (30 menit, 6 jam, 12 jam setelah percobaan awal; dokumen DOKU), dan sweeper default MATI.
1. Jangan aktifkan manual dan jangan ubah data langsung di DB.
2. Minta pemilik membuka `/billing?txn=<id>` (server bertanya ke DOKU; dibatasi 6 kali/menit per transaksi).
3. Atau Back Office DOKU, Integration, HTTP Notification, kirim ulang notifikasi (event belum final tetap diproses ulang).
4. Bila tetap gagal, ambil kode alasan di Q-A dan lanjut ke bagian 7.

### 5.4 Opsional: sweeper di situs sandbox
Kode sweeper tidak khusus Midtrans (memilih transaksi PENDING milik provider aktif, lewat `verifyAndSettle`) dan pengecualian `/api/internal/payments/sweep` sudah ada di `proxy.ts`
(catatan di `docs/GO_LIVE_PAYMENTS.md` bagian 5 yang meminta persetujuan pengecualian itu sudah usang; lihat P1-G). Untuk uji sandbox saja, Founder dapat mengisi di situs
sandbox: `PAYMENT_SWEEPER_ENABLED` (persis `true`) dan `PAYMENT_SWEEPER_SECRET` (acak, rahasia). Fungsi terjadwal hanya berjalan pada deploy Production situs itu.
Ini perubahan env di situs sandbox, bukan produksi. Jangan dilakukan di situs produksi.

## 6. Refund dan chargeback DOKU (interim; runbook refund repo masih khusus Midtrans)

Sumber: dokumentasi DOKU (bagian 8 dan 11). Aplikasi tidak melakukan refund otomatis dan tidak mencabut langganan.

### 6.1 Refund
- Kartu: dikembalikan hanya ke kartu asal lewat API pembatalan/instruksi tertulis ke DOKU.
- VA / toko: ke rekening bank pelanggan; DOKU butuh nama bank, nama pemilik, nomor rekening. DOKU memproses atas permintaan merchant; kirim tiket ke DOKU Care berisi
  Brand ID, nomor invoice, tanggal, nominal, rekening, nominal refund (penuh/sebagian). Biaya transaksi tetap ditanggung merchant. Batas transfer bank 25.000.000 per pencairan; target 10 hari kerja.
- E-wallet DOKU: ke dompet asal (3 hari kerja). QRIS: tidak dibahas di dokumen yang terjangkau (belum terverifikasi).
- Nomor rekening/kartu pelanggan: jangan ditulis di chat, PR, atau catatan aplikasi.
- Catat di `/ops/payments`: bila alert REFUND muncul, "Tandai sedang dicek", lalu "Selesaikan dengan catatan" (minimal 5 karakter: nomor refund, nominal, alasan, penyetuju, tanggal).
  Bila DOKU tidak melaporkan refund lewat Check Status (VA, bank), alert tidak akan muncul otomatis: catat di spreadsheet Founder sampai P1-F ada.

### 6.2 Chargeback
Chargeback datang dari acquirer lewat DOKU, bukan lewat status Check Status yang terdokumentasi. Merchant wajib membantu sanggahan (bukti penerimaan layanan),
dana dipotong dari settlement berikutnya, dan kekurangan saldo dibayar maks. 7 hari kerja (dokumen DOKU). Aplikasi belum punya jalur untuk mencatatnya: P1-F.

## 7. Template bukti B-CUR dan kriteria keputusan

B-CUR: apakah Check Status DOKU mengirim `order.currency` untuk pembayaran PAID di tiap channel. Kode saat ini fail-closed: PAID tanpa `currency` ditolak (503, tidak aktif).
Dokumen Check Status Non-SNAP DOKU yang terjangkau memang tidak mencantumkan `order.currency` (konsisten dengan asumsi A6 di `docs/BILLING_DOKU_SANDBOX_ADAPTER.md`).

### 7.1 Hubungan dengan PR #114 (Draft, belum merge)
- Tanpa #114, penolakan apa pun tertulis `GATEWAY_VERIFICATION_FAILED` saja: tidak bisa dibedakan antara currency hilang, timeout, order tidak cocok, dll. Bukti B-CUR TIDAK sah.
- Dengan #114, penanda menjadi `GATEWAY_VERIFICATION_FAILED:<KODE>` dengan kode dari himpunan tertutup: `STATUS_INCOMPLETE`, `ORDER_MISMATCH`, `CURRENCY_NOT_IDR`,
  `CURRENCY_MISSING`, `AMOUNT_MISSING`, `REFERENCE_MISSING`, `GATEWAY_REJECTED`, `GATEWAY_UNREACHABLE`, `GATEWAY_TIMEOUT`, `RESPONSE_NOT_JSON`. Perilaku fail-closed tidak berubah.
- Syarat sebelum mengumpulkan bukti: #114 direview Founder dan di-merge (atau, khusus sandbox, situs sandbox sengaja men-deploy cabang #114; catat SHA yang dideploy di tabel bukti).
- Kode alasan hanya tertulis lewat jalur webhook. Perjalanan kembali `/billing?txn=` tidak menulis baris event, jadi bukti B-CUR harus berasal dari notifikasi.

### 7.2 Query baca-saja (SQL Editor project sandbox)
Query inti:
```sql
select error from prompter_webhook_events where source_system='doku' and status='FAILED';
```
Pelengkap (urutan waktu dan hitungan; jangan menyalin kolom `payload`):
```sql
-- Q-A: penanda gagal per jenis
select coalesce(error,'-') as error, count(*) from public.prompter_webhook_events
 where source_system='doku' and status='FAILED' group by 1 order by 2 desc;
-- Q-B: SEMUA status event DOKU (menangkap IGNORED yang menyembunyikan UNKNOWN, lihat P0-A)
select status, coalesce(error,'-') as error, count(*) from public.prompter_webhook_events
 where source_system='doku' group by 1,2 order by 3 desc;
-- Q-C: linimasa transaksi (8 karakter awal id saja)
select left(t.id::text,8) as txn, t.status, t.plan, t.amount, t.currency, t.created_at,
       (select count(*) from public.prompter_invoices i where i.transaction_id=t.id and i.status='PAID') as invoice_paid,
       (select count(*) from public.prompter_webhook_events e where e.source_system='doku' and e.payload->>'orderId'=t.id::text) as events
  from public.prompter_payment_transactions t where t.provider='doku' order by t.created_at desc limit 30;
-- Q-D: periode langganan tenant uji
select left(s.tenant_id::text,8) as tenant, tn.nama_usaha, s.plan, s.status, s.current_period_end
  from public.prompter_subscriptions s join public.tenants tn on tn.id=s.tenant_id where tn.nama_usaha like 'E2E%';
-- Q-E: antrean alert
select kind, state, left(transaction_id::text,8) as txn, reason, first_seen_at
  from public.prompter_payment_alerts order by first_seen_at desc limit 20;
-- Q-F: harus 0 baris (satu invoice per transaksi)
select transaction_id, count(*) from public.prompter_invoices where transaction_id is not null group by 1 having count(*) > 1;
```

### 7.3 Yang dicatat dan yang DILARANG disalin
Boleh dicatat (kata/angka non-sensitif): tanggal-jam WIB; ID skenario; channel (VA/QRIS/e-wallet/kartu + nama channel yang tampil); 8 karakter awal id transaksi;
status txn; status/error event; kode alasan; ada-tidaknya `order.currency` (ya/tidak, dan nilainya hanya jika `IDR`); kata `transaction.status`, `transaction.type`, `order.status`;
ada-tidaknya objek `refund` dan blok `card_payment` (ya/tidak); apakah nominal DOKU sama dengan invoice (ya/tidak); jumlah periode; SHA deploy sandbox.

DILARANG disalin ke repo/chat/PR/log: Client ID, Secret Key, header `Signature`, `Request-Id`/`original_request_id`, nomor VA, string QR, token_id dan URL halaman bayar,
nomor kartu/`card_masked`/kode persetujuan, nama/email/telepon/rekening pembayar, isi `payload` event, tangkapan layar yang memuat salah satunya (potong dulu).

### 7.4 Tabel bukti (salin ke catatan Founder, bukan ke repo bila memuat apa pun di luar daftar di atas)

| ID | Waktu WIB | Channel | Txn (8 kar.) | Txn status | Event status/error | Kode alasan | currency ada? | Aktivasi (periode) | Invoice PAID | SHA deploy | Catatan |
|---|---|---|---|---|---|---|---|---|---|---|---|

### 7.5 Kriteria keputusan (per channel)
- **A. Currency ada**: minimal 2 pembayaran PAID independen di channel itu berakhir `PROCESSED` tanpa `CURRENCY_MISSING`. B-CUR TERTUTUP untuk channel itu; tidak ada perubahan kode.
- **B. Currency hilang**: minimal 2 pembayaran independen di channel yang sama berakhir `FAILED:CURRENCY_MISSING`, tanpa kode lain. B-CUR TERBUKTI. Pilihan (PR terpisah, persetujuan Founder, tidak ada yang dilakukan otomatis):
  (1) menerima `currency` kosong hanya untuk channel yang terbukti, dengan syarat tambahan: nomor invoice kanonik milik kita cocok, `order.amount` sama dengan nominal transaksi di DB kita, checkout mengirim `IDR` eksplisit
  (butuh capture channel, P1-D); (2) tanya DOKU Care apakah respons bisa memuat `currency`; (3) menyembunyikan channel itu lewat `payment_method_types` (perubahan kode checkout).
  Selama keputusan belum ada, channel itu tidak boleh dibuka ke pelanggan.
- **C. Kode lain** (`STATUS_INCOMPLETE`, `ORDER_MISMATCH`, `AMOUNT_MISSING`, `REFERENCE_MISSING`, `CURRENCY_NOT_IDR`, `GATEWAY_*`, `RESPONSE_NOT_JSON`): bukan B-CUR. Selidiki terpisah; jangan melonggarkan kode.
- **D. Hanya penanda lama tanpa kode**: #114 belum terdeploy; bukti tidak sah, ulangi.
- **E. Channel tidak tersedia di sandbox**: status "tidak bisa dibuktikan di sandbox"; tetap terbuka sebagai syarat live untuk channel itu.
- Hasil campuran per channel diputuskan per channel. Satu contoh tidak cukup. Hasil `UNKNOWN` (S4 AUTHORIZE dst.) dicatat terpisah sebagai bukti A13.

## 8. Daftar persyaratan aktivasi merchant DOKU

Sumber diakses 2026-11-11. Ringkasan halaman dibaca lewat alat pembaca-ringkas, bukan salinan penuh: periksa ulang kutipan penting di halaman aslinya sebelum keputusan.

| Persyaratan | Status | Sumber |
|---|---|---|
| Daftarkan bisnis di Back Office: nama badan hukum, bidang usaha, alamat, kontak, website/akun sosial, penanda tangan berwenang; pilih layanan; unggah dokumen (jenis dokumen bergantung lokasi, bidang usaha, kewarganegaraan penanda tangan) | VERIFIED | dashboard.doku.com/docs/docs/getting-started/register-business |
| KYB 2x24 hari kerja; akun mulai di mode sandbox; setelah KYB disetujui, ganti Client ID dan Secret Key sandbox dengan produksi di Service Management | VERIFIED | idem |
| DOKU tidak menyelesaikan (settle) dana untuk bisnis yang belum terverifikasi; settlement hari kerja pukul 12:00-14:00 WIB; T+1 sampai T+4 menurut channel (VA bank lain T+1, VA BCA/DOKU T+2, QRIS T+1, e-wallet T+1/T+2, kartu T+2/T+3, toko T+4) | VERIFIED | docs.doku.com/accept-payments/finance-and-settlement/settlement-time |
| Laporan settlement: Dashboard, Reports, Settlements; terkirim otomatis lewat email/SFTP, ada Resend Report | VERIFIED (format kolom tidak disebut) | docs.doku.com/get-started/manage-business/manage-reports/settlement-report |
| Notification URL per channel (Settings, Payment Settings); wajib publik, tanpa autentikasi/VPN/port tak lazim; domain ngrok tidak didukung; `https` dianjurkan | VERIFIED | developers.doku.com/get-started-with-doku-api/notification/setup-notification-url |
| Notifikasi wajib dijawab 2xx; bila tidak: 3 percobaan ulang (30 menit, 6 jam, 12 jam); kirim ulang manual di Integration, HTTP Notification; handler harus idempoten | VERIFIED | .../notification/retry-notification dan .../notification/best-practice |
| Host produksi API: `api.doku.com` (sandbox: `api-sandbox.doku.com`); Check Status dipanggil ≥ 60 detik setelah bayar | VERIFIED | dashboard.doku.com/docs/docs/http-notification/check-status-non-snap; developers.doku.com/accept-payments/doku-checkout/integration-guide/backend-integration |
| Status level-order Checkout hanya untuk merchant terdaftar sejak Desember 2024; merchant lama harus minta aktivasi ke DOKU | VERIFIED | developers.doku.com/accept-payments/doku-checkout/order-status-for-checkout-page; changelog.doku.com/july-2025/checkout-new-fields-and-status-values-on-check-status-api |
| Refund dan chargeback: lihat bagian 6 | VERIFIED (QRIS tidak dibahas) | docs.doku.com/accept-payments/finance-and-settlement/refund-and-chargeback/refund-and-chargeback; help.doku.com (refund non-kartu) |
| Daftar dokumen spesifik per jenis badan usaha (PT/CV/perorangan) dan syarat NIB/NPWP/akta | BELUM TERVERIFIKASI | halaman yang terjangkau tidak merincinya; tanya DOKU Care |
| Aturan kode pos/alamat merchant dan penyebab penolakan saat ini | BELUM TERVERIFIKASI | DOKU sedang memperbaiki, belum ada konfirmasi. EXTERNAL BLOCKED |
| Channel mana yang aktif untuk merchant ini, biaya, kontrak, dan syarat per channel | BELUM TERVERIFIKASI | tanya DOKU Care / lihat Service Management |
| Ketersediaan penuh semua channel dan refund/settlement di sandbox | BELUM TERVERIFIKASI | dicatat saat S1-S11 |
| Daftar periksa go-live resmi DOKU, daftar IP DOKU untuk allowlist, kebijakan timestamp notifikasi | BELUM TERVERIFIKASI | tidak ditemukan halaman resmi yang terjangkau |

Catatan: dokumen DOKU menyebut `payment_method_types` bila dihilangkan menampilkan semua metode yang tersedia, dan kode kita memang tidak mengirimnya. Namun halaman yang sama
menyebut permintaan dasar hanya terjamin untuk VA, kartu, QRIS, toko, dan e-money (OVO, LinkAja); e-wallet lain bisa butuh data tambahan (asumsi A12). Buktikan di S3.

## 9. Celah teknis yang belum tertutup (rekomendasi; tidak ada yang dikerjakan di PR ini)

Temuan baru dari audit 2026-11-11, bukan pengulangan audit yang sudah PASS. Semua berstatus CODE belum dibuat. P0 = harus selesai sebelum bukti sandbox dianggap lengkap
atau sebelum live; P1 = sebelum pelanggan nyata; P2 = perbaikan lanjutan.

### P0-A. Status UNKNOWN pada notifikasi yang bukan klaim PAID tercatat diam-diam sebagai IGNORED
- Bukti: `services/payment-webhook.ts` cabang `NOT_PAID`: penanda `VERIFIED_STATUS_UNKNOWN` hanya dipakai bila notifikasi mengklaim PAID. Notifikasi dengan kata status baru/tak dikenal diklaim `FAILED`
  (`claimFromNotification`), lalu bila DOKU juga menjawab UNKNOWN, kode jatuh ke `markVerifiedEvent("IGNORED", null)` dan menjawab 200 (DOKU berhenti mencoba ulang). Tes `payment-webhook-doku.test.ts`
  "an unrecognised DOKU status..." membuktikan 200 tanpa penanda. Akibatnya status tak dikenal (mis. kata chargeback yang tidak terdokumentasi) tidak terlihat oleh query B-CUR (`status='FAILED'`).
- Rancangan: pada cabang `NOT_PAID` dengan `outcome.status === "UNKNOWN"` dan klaim bukan PAID, tulis `IGNORED` dengan `error='VERIFIED_STATUS_UNKNOWN'` (tanpa migrasi; kolom `error` sudah teks bebas). Tetap jawab 200.
- File: `services/payment-webhook.ts`, `tests/unit/services/payment-webhook-doku.test.ts`, `docs/BILLING_DOKU_SANDBOX_ADAPTER.md` (query pantau tidak boleh menyaring `status`).
- Acceptance: (1) notifikasi klaim FAILED + jawaban DOKU `SOMETHING_NEW` menghasilkan baris event `IGNORED` dengan `error='VERIFIED_STATUS_UNKNOWN'`, respons 200, txn tetap PENDING, nol RPC aktivasi; (2) klaim PAID + UNKNOWN tetap 503 `FAILED`;
  (3) Midtrans tidak berubah (tes regresi `payment-webhook-midtrans.test.ts` hijau); (4) Q-B menampilkan baris itu.

### P0-B. Tidak ada peringatan untuk UNKNOWN / verifikasi gagal berulang
Antrean B4 hanya mengenal `REVIEW`, `REFUND`, `CHARGEBACK`, `REVERSAL` (CHECK pada `prompter_payment_alerts.kind`, `types/database.ts` `PaymentAlertKind`, `lib/billing/payment-alerts.ts`).
- **P0-B1 (tanpa migrasi, dikerjakan dulu)**: kartu "Kesehatan webhook DOKU" di `/ops/payments`: hitungan 24 jam terakhir untuk event `source_system='doku'` dengan `error` = `VERIFIED_STATUS_UNKNOWN`, diawali `GATEWAY_VERIFICATION_FAILED`, atau `VERIFIED_STATUS_NOT_PAID`, plus umur terlama.
  File: `services/payment-alerts.ts` (fungsi baca baru, tidak melempar), `app/ops/payments/page.tsx`, tes baru. Acceptance: hanya operator (404 untuk lainnya); tidak menampilkan `payload`; kosong menampilkan 0; gagal baca menampilkan peringatan, bukan crash; tes statis seperti `payment-alerts-static-guards`.
- **P0-B2 / P1 (butuh migrasi; HANYA rancangan, file migrasi belum dibuat dan tidak boleh dibuat tanpa persetujuan Founder)**: jenis alert `UNVERIFIED`.
  Rancangan: (a) perluas CHECK `kind` dengan `'UNVERIFIED'`; (b) `fn_sync_payment_alerts` v3 langkah (d): per transaksi DOKU yang masih PENDING, bila ada ≥ 3 event dengan `error` di himpunan di atas atau yang tertua > 1 jam, buat alert `UNVERIFIED` severity HIGH,
  idempoten lewat `unique (transaction_id, kind)`, resolve otomatis saat txn PAID/EXPIRED; (c) `fn_record_payment_alarm` tidak diubah; (d) rollback mengembalikan CHECK dan badan fungsi (tolak bila ada alert `UNVERIFIED` belum RESOLVED).
  File masa depan: `supabase/migrations/<ts>_prompter_p0_4_unverified_alert.sql`, `supabase/rollback/<ts>_...down.sql`, `types/database.ts`, `lib/billing/payment-alerts.ts` (peta label `Record<PaymentAlertKind,...>` akan memaksa kompilasi gagal bila terlewat), paket sandbox `supabase/sandbox/doku/` (pola `build_p03_package.py`), tes SQL di CI.
  Acceptance: terapkan dulu ke sandbox lewat runner; smoke dummy membuat tepat 1 alert per transaksi; sync dua kali tidak menggandakan; md5 badan fungsi sebelum/sesudah sesuai audit; produksi tidak disentuh sampai ada persetujuan terpisah.

### P0-C. Pembayaran sah bisa menggantung PENDING (DOKU hanya mencoba ulang 3 kali; sweeper MATI)
- Bukti: webhook 503 memicu percobaan ulang DOKU hanya pada 30 menit, 6 jam, 12 jam; setelah itu hanya perjalanan kembali pelanggan atau sweeper yang bisa menyelesaikan. Pembayaran lewat aplikasi bank (VA/QRIS) sering tidak kembali ke situs.
  `/ops/payments` "Sinkronkan sekarang" hanya menyinkronkan alert, tidak memverifikasi transaksi.
- Rancangan: aksi operator "Verifikasi ulang" untuk transaksi `PENDING` provider DOKU berumur > 10 menit yang memanggil `verifyAndSettle` yang sudah ada (tanpa mengubah `proxy.ts`, karena ada di dalam aplikasi dengan gerbang operator),
  dibatasi laju seperti `checkRateLimit('payment-return:...')`. Alternatif tanpa kode untuk sandbox: bagian 5.4.
- File: `app/ops/payments/actions.ts`, `services/payment-operator.ts` (atau fungsi baru di `services/payment-sweeper.ts`), `app/ops/payments/page.tsx`, tes.
- Acceptance: non-operator ditolak; hanya PENDING DOKU berumur > 10 menit; hasil memakai jalur `verifyAndSettle` (tidak ada aktivasi dari input operator); idempoten (klik dua kali = satu periode); 7 kali dalam semenit ditolak; tidak ada perubahan skema.

### P1-D. Channel pembayaran tidak tercatat, sehingga bukti B-CUR per channel bergantung catatan manual
- Rancangan: `getVerifiedPayment` mengembalikan `channelId` opsional (`channel.id`/`service.id` dari Check Status, kata saja), disimpan pada `payload` event lewat `extraPayload` di `markVerifiedEvent` (kolom `payload` sudah jsonb; tanpa migrasi).
- File: `lib/billing/payment-provider.ts`, `lib/billing/providers/doku-payment-provider.ts`, `services/payment-webhook.ts`, tes. Kerjakan SETELAH #114 merge (menyentuh file yang sama).
- Acceptance: nilai dibatasi panjang dan karakter; tidak mengubah keputusan aktivasi; Midtrans tidak berubah; Q-A bisa dikelompokkan per channel.

### P1-E. Ekspor rekonsiliasi tidak memuat nomor invoice DOKU
- `lib/billing/reconciliation-csv.ts` hanya memuat UUID; laporan DOKU memakai `order.invoice_number` (`LN` + 25 karakter, hasil `encodeDokuInvoiceNumber`). Pencocokan manual sulit.
- Rancangan: kolom `provider_invoice_ref` (diisi `encodeDokuInvoiceNumber(id)` bila `provider='doku'`, kosong lainnya). File: `lib/billing/reconciliation-csv.ts`, `app/ops/payments/export/route.ts`, `tests/unit/lib/ops-export-static-guards.test.ts` + tes CSV.
- Acceptance: kolom baru di akhir/di posisi yang didokumentasikan; tidak ada rahasia/payload; injeksi CSV tetap tertangani; baris Midtrans tidak berubah selain kolom kosong.

### P1-F. Refund/chargeback DOKU non-kartu tidak punya jalur pencatatan
- Check Status tidak mendokumentasikan refund VA/bank, dan `mapDokuStatus` tidak punya status chargeback; refund VA dilakukan manual lewat tiket DOKU Care.
- Rancangan (tanpa migrasi; `fn_record_payment_alarm` sudah ada, service_role): aksi operator "Catat refund/chargeback manual" yang memanggil `recordPaymentAlarm(admin, txn, 'REFUND'|'CHARGEBACK', bukti, 'manual:'+referensi)`.
- File: `app/ops/payments/actions.ts`, `services/payment-operator.ts`/`services/payment-alerts.ts`, tes. Acceptance: operator saja; transaksi harus PAID dan milik provider doku; catatan ≥ 5 karakter; referensi unik membuat satu alert, ulangan hanya menambah penghitung; langganan tidak berubah; tidak menyimpan nomor rekening/kartu.

### P1-G. Dokumen operasional masih khusus Midtrans
- `docs/GO_LIVE_PAYMENTS.md` dan `docs/REFUND_RUNBOOK.md` Midtrans-only; bagian 5 GO_LIVE menyebut pengecualian `proxy.ts` untuk sweeper masih butuh persetujuan padahal pengecualiannya sudah ada. Rancangan: bagian DOKU pada dua berkas itu, setelah runbook ini teruji. Doc-only.

### P1-H. Jendela timestamp notifikasi (A10) dan perilaku Request-Id kirim ulang (A8)
- Putuskan setelah S6 mengukur perilaku kirim ulang DOKU. File: `lib/billing/providers/doku-payment-provider.ts` (`verifyWebhookRequest`), tes. Acceptance: jendela dipilih dari data S6, notifikasi kirim ulang yang sah (6 dan 12 jam) tidak ditolak.

### P1-I. Atestasi DB sisi-database (B-DB) dan guard untuk mode live
- Guard saat ini menolak ref produksi seluruhnya (`PRODUCTION_SUPABASE_REFS`), jadi mode live DOKU nanti butuh rancangan guard berbeda yang tidak boleh melemahkan guard sandbox. Butuh keputusan Founder dan migrasi (marker); hanya rancangan. Terbuka dari dokumen adapter.

### P1-J. Migrasi P0-3 untuk produksi
- Terpasang hanya di sandbox. Tanpa itu di produksi, event `ALARM_*` dari DOKU tidak menjadi alert lewat sinkron (jalur langsung `fn_record_payment_alarm` tetap bekerja). Penerapan produksi butuh paket dan persetujuan terpisah. Bukan bagian PR ini.

### P1-K. Seed E2E lewat runner (menggantikan SQL manual bagian 4)
- Berkas seed tenant E2E di `supabase/sandbox/doku/` dengan tahap runner baru, menjaga golden state. Rancangan saja; mengubah pohon sandbox mengubah hash `tree`.

### P2
- P2-L: DOKU menyediakan Cancel Order API untuk pesanan PENDING; adapter belum memakainya. Saat kita menutup invoice EXPIRED lokal, pesanan di DOKU bisa tetap dibayar lewat tautan pemulihan; kasus itu sudah aman (REVIEW) tetapi bukan optimal.
- P2-M: workflow probe negatif webhook (tanda tangan salah, replay) dari GitHub Actions memakai Environment `doku-sandbox`. Butuh Secret Key sandbox sebagai secret Actions, jadi pertimbangkan risikonya; tes unit sudah mencakup perilaku ini.
- P2-N: ingest laporan settlement otomatis. Sebelum live cukup pencocokan manual (S11, S12).
- `ORDER_RECOVERED` (dokumen DOKU) tidak ditangani khusus: SUCCESS + `ORDER_RECOVERED` menjadi PAID lalu B2 memutuskan (late payment ke REVIEW bila invoice sudah ditutup). Catat saat S9.

## 10. Daftar periksa "kapan boleh membahas PAYMENT_LIVE_ENABLED"

Ini syarat bukti, bukan jadwal. Semua harus terpenuhi sebelum percakapan tentang menyalakan live boleh DIMULAI. Memenuhi semuanya tidak menyalakan apa pun: menyalakan live tetap butuh PR kode live terpisah, review, dan
persetujuan tertulis Founder dengan frasa persetujuan eksplisit. Catatan kode: adapter DOKU menolak `PAYMENT_LIVE_ENABLED` berisi nilai apa pun dan hanya memiliki host sandbox; mengisi flag itu saat ini justru mematikan DOKU.

- [ ] KYB DOKU disetujui dan kode pos merchant terkoreksi (bukti: status Back Office atau konfirmasi tertulis DOKU, tanpa data sensitif). EXTERNAL BLOCKED sampai ada konfirmasi.
- [ ] Channel yang akan dibuka sudah aktif untuk merchant produksi (Service Management) dan Notification URL produksi diisi per channel.
- [ ] Untuk tiap channel yang akan dibuka: S1-S4 (sesuai channel), S5-S8, S12, S13, S15 berstatus SANDBOX E2E PASS dengan bukti di tabel 7.4.
- [ ] B-CUR tertutup per channel (kriteria A) atau keputusan B diimplementasi dan teruji; PR #114 merged.
- [ ] A8 dan A10 diputuskan dari data nyata (S6), A13 (tipe kartu) terbukti, A9 (domain halaman bayar) terbukti.
- [ ] P0-A, P0-B1, P0-C selesai dan teruji; P0-B2 diputuskan (dikerjakan atau ditolak dengan alasan tertulis).
- [ ] Jalur refund dan chargeback DOKU terdokumentasi final (P1-F dan P1-G), dan satu refund uji sandbox atau tiket DOKU nyata dicatat.
- [ ] Rekonsiliasi: satu rentang hari uji cocok dengan laporan DOKU (P1-E); laporan settlement pertama pada produksi dijadwalkan untuk dicocokkan.
- [ ] Migrasi P0-3 untuk produksi disetujui dan diterapkan lewat jalur produksi yang berlaku, atau keputusan tertulis bahwa jalur langsung cukup (P1-J).
- [ ] Rancangan guard DB untuk mode live (P1-I) disetujui; kode live DOKU ditulis terpisah, ditinjau, dengan host produksi hanya di jalur itu.
- [ ] Operator pembayaran aktif di produksi; prosedur rollback (bagian 6 `docs/GO_LIVE_PAYMENTS.md`, disesuaikan DOKU) dilatih dengan kosongkan env dan deploy ulang.
- [ ] Persetujuan tertulis Founder (tanggal/jam, frasa persetujuan eksplisit) sebelum perubahan env produksi apa pun.
- [ ] Tidak ada rahasia pada repo/log/PR selama seluruh proses; Secret Key sandbox diputar setelah uji selesai.

## 11. Sumber (diakses 2026-11-11)
- https://dashboard.doku.com/docs/docs/getting-started/register-business
- https://dashboard.doku.com/docs/docs/http-notification/check-status-non-snap
- https://developers.doku.com/get-started-with-doku-api/notification/retry-notification.md
- https://developers.doku.com/get-started-with-doku-api/notification/best-practice.md
- https://developers.doku.com/get-started-with-doku-api/notification/setup-notification-url.md
- https://developers.doku.com/accept-payments/doku-checkout/integration-guide/simulate-payment-and-notification.md
- https://developers.doku.com/accept-payments/doku-checkout/integration-guide/backend-integration.md
- https://developers.doku.com/accept-payments/doku-checkout/configuration.md
- https://developers.doku.com/accept-payments/doku-checkout/order-and-notification-handling.md
- https://developers.doku.com/accept-payments/doku-checkout/order-status-for-checkout-page
- https://changelog.doku.com/july-2025/checkout-new-fields-and-status-values-on-check-status-api
- https://docs.doku.com/accept-payments/finance-and-settlement/settlement-time
- https://docs.doku.com/accept-payments/finance-and-settlement/refund-and-chargeback/refund-and-chargeback
- https://docs.doku.com/get-started/manage-business/manage-reports/settlement-report
- https://help.doku.com/en/support/solutions/articles/66000515913-how-to-process-refund-of-my-non-credit-card-transaction-

Tidak terjangkau dari sesi ini (di luar daftar akses): halaman `jago.doku.com`, halaman Finance and Settlement di `developers.doku.com`, dan halaman refund kartu di `developers.doku.com`. Isi yang bergantung pada halaman-halaman itu ditandai belum terverifikasi.
