# Billing B4 — Antrean alarm pembayaran (B4.1 dibangun, B4.2 hanya rancangan)

Status: **Draft PR. Belum diterapkan ke database mana pun. Pembayaran live tetap HOLD.**

## 1. Masalah yang ditutup

| Temuan | Sebelum B4.1 | Sesudah B4.1 |
|---|---|---|
| P1 — dedupe alarm B3 memakai `prompter_audit_logs`, yang **bisa ditulis anggota tenant** (policy "Tulis audit log sebagai diri sendiri") | Anggota tenant bisa menulis baris palsu `payment.refund_reported` sehingga alarm asli ditekan | Tabel audit **tidak dibaca dan tidak ditulis lagi** untuk alarm. Dedupe dilakukan database: `unique (transaction_id, kind)` di tabel khusus service_role |
| P1 — tidak ada penerima/antrean alarm | REVIEW, refund, chargeback hanya tercatat | Antrean `/ops/payments` untuk operator |
| P2 — alarm bisa hilang jika job gagal | — | Antrean selalu **dihitung ulang** dari sumber tepercaya; kegagalan tidak menghilangkan apa pun |

## 2. Sumber tepercaya vs tidak

| Sumber | Siapa bisa menulis | Dipakai? |
|---|---|---|
| `prompter_payment_transactions` (status `REVIEW`) | hanya fungsi service_role | **Ya** |
| `prompter_webhook_events` (`error = ALARM_*`) | hanya service_role (tenant tidak punya policy insert; `tenant_id` null sehingga tidak terlihat tenant) | **Ya** |
| Panggilan server setelah Get Status Midtrans (`fn_record_payment_alarm`) | hanya service_role | **Ya** |
| `prompter_audit_logs` | **anggota tenant** | **Tidak** |

`tenant_id` pada alarm selalu diambil dari baris transaksi milik kita, tidak pernah dari payload.

## 3. Objek database (migrasi `20261031100000`)

Semua baru, berawalan `prompter_`/`fn_`, aditif. Tidak menyentuh PUBLOE, UMKMpro, Finance Hub, transaksi, langganan, atau tabel yang ada.

- `prompter_payment_operators` — allowlist operator (user id). Diisi Founder lewat SQL Editor. Bukan Admin Center / Finance Hub.
- `prompter_payment_alerts` — satu baris per (transaksi, jenis): `REVIEW | REFUND | CHARGEBACK | REVERSAL`; status `OPEN → ACKED → RESOLVED`. Tidak ada FK ke transaksi (penghapusan tenant tidak boleh terblokir atau menghapus bukti). Tidak bisa DELETE/TRUNCATE.
- `prompter_payment_alert_actions` — riwayat append-only (ACK, RESOLVE, AUTO_RESOLVE, REOPEN); UPDATE/DELETE/TRUNCATE diblok trigger.
- `prompter_payment_alert_evidence` — registri append-only identitas kejadian (`evidence_ref`) yang sudah dilihat per alarm + cuplikan buktinya. Inilah pembeda "kejadian BARU" vs "replay kejadian lama".
- `prompter_payment_alert_sync_state` — satu baris: sinkron terakhir, error terakhir, jumlah gagal beruntun.
- Fungsi (hanya `service_role`): `fn_sync_payment_alerts`, `fn_record_payment_alarm`, `fn_ack_payment_alert`, `fn_resolve_payment_alert`, `fn_note_payment_alert_sync_failure`, `fn_is_payment_operator`.
- RLS aktif tanpa policy + `revoke all` dari `public/anon/authenticated`: tenant tidak bisa membaca, menulis, atau memanggil apa pun.

Fungsi operator hanya menulis baris alarm dan riwayat. **Tidak ada** yang menyentuh transaksi, langganan, atau uang (dibuktikan tes: sidik jari tabel transaksi dan langganan identik sebelum/sesudah).

## 3b. Alarm dibuka ulang (perbaikan P1) dan hardening P2

**Aturan.** Satu alarm per (transaksi, jenis). `fn_record_payment_alarm(txn, jenis, bukti, evidence_ref)` dipanggil server setelah jawaban Get Status Midtrans:
- ref belum pernah dilihat + alarm RESOLVED → `REOPENED` (OPEN lagi, `reopened_count+1`, riwayat `REOPEN`, resolusi lama dibersihkan, riwayat RESOLVE tetap);
- ref sudah dikenal + RESOLVED → `REPEAT` (tetap RESOLVED, hanya `repeat_count+1`; replay webhook lama tidak membuka ulang);
- alarm belum RESOLVED → `EXISTING` (ref baru tetap dicatat, tidak hilang); belum ada → `CREATED`.
- Aman paralel: baris alarm dikunci `FOR UPDATE`, pembuatan lewat `ON CONFLICT`, registri ber-PK (alarm, ref). Hasil tes: 10 panggilan identik → tepat 1 REOPENED; 2 refund berbeda paralel → 1 alarm, 1 reopen, kedua identitas tercatat.
- Sinkron periodik hanya MEMBUAT alarm yang hilang, tidak pernah membuka ulang. Tabel audit milik tenant tidak dipakai.

**Identitas kejadian.** Midtrans tidak memberi ID per notifikasi. `evidence_ref` diturunkan server dari jawaban Get Status itu sendiri (`buildMidtransEventRef`): status + kode + bidang refund/chargeback yang ada (jumlah, id/kunci refund, waktu), bukan dari body webhook. **Batasan:** bila jawaban hanya memuat status tanpa rincian (`event_ref_basis = status_only`), refund kedua yang tampak identik tidak bisa dibedakan dari replay; ia dihitung di `repeat_count` dan ditampilkan di halaman ("Sinyal serupa"), tidak hilang diam-diam. Nama bidang refund/chargeback Midtrans harus dikonfirmasi di sandbox sebelum live.

**P2 `search_path`.** Semua 8 fungsi (6 SECURITY DEFINER + 2 trigger) memakai `set search_path = public, pg_temp`, dan semuanya di-revoke dari public/anon/authenticated. Tes: kontrol (fungsi `search_path = public` biasa) TERTIPU tabel temp bayangan, fungsi B4 tidak; penyerang bukan operator dan tidak bisa ACK/RESOLVE.

## 4. Alur deteksi

1. **Langsung (event-driven):** webhook/return-from-checkout → Get Status Midtrans → status `refund/chargeback/cancel-setelah-PAID` → `fn_record_payment_alarm` (idempoten, `CREATED`/`EXISTING`). Jika gagal → HTTP 500 sehingga Midtrans mencoba ulang.
2. **Sinkron (jaring pengaman):** `fn_sync_payment_alerts()` menurunkan ulang dari transaksi `REVIEW` + event webhook `ALARM_*` (jendela 45 hari) dan **auto-resolve** alarm REVIEW yang transaksinya sudah tidak REVIEW (diselesaikan resolver terverifikasi gateway).
3. **Pemicu sinkron tanpa bergantung pg_cron/pg_net:**
   - halaman `/ops/payments` menyinkronkan otomatis bila sinkron terakhir > 5 menit;
   - tombol "Sinkronkan sekarang";
   - **opsional** `pg_cron` (hanya SQL murni, tanpa `pg_net`) — file terpisah, hanya dijalankan setelah audit read-only membuktikan `pg_cron` tersedia dan Founder menyetujui (lihat §7).

Keamanan paralel: `pg_try_advisory_xact_lock` (yang kalah langsung `skipped=true`), semua penulisan `ON CONFLICT DO NOTHING`, satu transaksi (gagal = rollback total; percobaan berikutnya menghitung ulang). Kegagalan dicatat terpisah (`fn_note_payment_alert_sync_failure`) dan terlihat di halaman.

Catatan perilaku (disengaja): alarm yang sudah di-RESOLVE operator **tidak dibuka lagi** oleh sinkron, termasuk bila transaksinya masih `REVIEW` — itu keputusan operator yang tercatat dengan catatan wajib. Satu alarm per (transaksi, jenis): event refund kedua untuk transaksi yang sama tidak membuat alarm baru; gunakan catatan operator.

## 5. Halaman operator `/ops/payments`

- Mobile-first, tanpa JavaScript klien (form HTML + server action) sehingga ringan di Chrome Android.
- Akses: sesi Supabase asli (`auth.getUser()`) **dan** user id ada di `prompter_payment_operators` (aktif). Selain itu → 404 (keberadaan halaman tidak dibocorkan). Setiap aksi memeriksa ulang di server dan di database. Menjadi owner tenant / admin platform / finance admin **tidak** memberi akses.
- Aksi: "Tandai sedang dicek", "Selesaikan dengan catatan" (≥5 karakter), "Sinkronkan sekarang". Rate limit per operator. Aktor selalu id sesi, bukan input form.
- **Tidak ada** tombol aktivasi, refund, atau perubahan langganan; tes statis memastikan file halaman/aksi/layanan tidak menyebut fungsi aktivasi/checkout/resolver, tabel transaksi/langganan, atau `insert/update/delete`.

## 6. Pengujian

- SQL (CI job `billing-b4-sql`, PostgreSQL 17; bukan Supabase): alarm duplikat (event ganda, 15 panggilan paralel), sinkron paralel (12 sekaligus), kunci advisory, record vs sync berlomba, 10 ACK paralel, RESOLVE paralel, **job gagal lalu retry** (rollback total, kegagalan tercatat, retry menurunkan ulang semuanya), isolasi tenant (tabel dan fungsi), operator tak berwenang (uuid acak, operator nonaktif, owner tenant), **audit palsu** (diterima tabel audit tetapi tidak membuat/menekan alarm), auto-resolve REVIEW, transaksi/langganan identik, bukti tidak bisa dihapus, rollback.
- Unit (vitest): helper, layanan, aksi operator (denied/invalid/rate/aktor), penjaga statis, dan tes B3 yang diperbarui (alarm masuk antrean, audit palsu tak berpengaruh, payload event membawa `orderId`).

## 7. Rencana penerapan aman (setelah Founder menyetujui; Founder yang menjalankan SQL)

1. Merge PR (kode inert: halaman 404 bagi semua orang sampai ada operator; `recordAlarm` memanggil fungsi yang belum ada → **jangan merge/deploy kode sebelum migrasi diterapkan**, atau webhook alarm akan 500 dan Midtrans mencoba ulang; Midtrans masih nonaktif karena `PAYMENT_PROVIDER_NAME` belum diisi).
   Urutan aman (6 file SQL dibuat ulang dari migrasi final, checksum di header): **(a)** preflight read-only → **(b)** apply SQL Editor → **(c)** verify read-only → **(d)** ledger → **(e)** baru merge + deploy.
2. Tambah operator pertama (Founder, SQL Editor): `insert into prompter_payment_operators(user_id,label,created_by) select id,'Founder','founder' from auth.users where email = '<email Founder>'`.
3. (Opsional) audit read-only `pg_cron`; jika ada dan disetujui, jadwalkan `select public.fn_sync_payment_alerts();` tiap 5–15 menit. Tanpa pg_cron, halaman operator tetap menyinkronkan sendiri saat dibuka, dan jalur langsung tetap bekerja.
4. Rollback: `supabase/rollback/20261031100000_prompter_b4_payment_alerts.down.sql` menolak jalan bila ada baris alarm/riwayat (bukti).

## 8. B4.2 — RANCANGAN SAJA (belum dibangun, tidak ada pengiriman aktif)

**8.1 Re-verifikasi PAID berkala** (menangkap refund/chargeback yang webhooknya hilang; Midtrans hanya mengulang notifikasi ± 5 menit):

- Kandidat: transaksi `PAID` provider `midtrans`, `paid_at` ≤ 30 hari, diurutkan yang paling lama dicek. Butuh kolom/tabel `last_verified_at` di tabel **milik B4** (bukan mengubah tabel transaksi): `prompter_payment_verification_runs(transaction_id, checked_at, gateway_status, ok)`.
- Pemanggil: runner server yang mengambil batch kecil (mis. 20), memanggil `getVerifiedPayment` (Get Status, timeout 5 dtk yang sudah ada), lalu **hanya** memakai `recordPaymentAlarm` bila status refund/chargeback/cancel. Tidak pernah mengubah langganan. Pembatasan laju ke Midtrans (mis. ≤ 1 req/dtk), backoff, dan batas harian.
- Pemicu: butuh HTTP terjadwal. Opsi: (1) `pg_cron` + `pg_net` memanggil rute internal — **wajib audit read-only dulu**, dan rute `/api/internal/*` saat ini diblok proxy (butuh pengecualian proxy = perubahan yang butuh persetujuan Founder); (2) Netlify Scheduled Function; (3) pemicu eksternal gratis dengan bearer secret. Tidak ada yang diaktifkan di B4.1.
- Idempoten karena alarm unik per (transaksi, jenis).

**8.2 Notifikasi aktif ke operator** (hemat biaya):

| Opsi | Biaya | Catatan |
|---|---|---|
| **Telegram Bot** (rekomendasi) | gratis | Push langsung ke HP Android; hanya butuh `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` di env Netlify; pesan tanpa data sensitif (jenis, tingkat, 8 karakter awal id, tautan `/ops/payments`) |
| Email (Resend/SMTP) | gratis tingkat kecil | Perlu domain/pengirim terverifikasi; lebih lambat dilihat |
| WhatsApp API | berbayar per pesan | Tidak direkomendasikan di tahap ini |
| Web Push | gratis | Perlu PWA/service worker; lebih rumit |

Rancangan: kolom `notified_at/notify_attempts/next_notify_at` di **tabel alarm B4** (migrasi B4.2), pengirim mengambil alarm `OPEN` belum diberi tahu dengan `FOR UPDATE SKIP LOCKED`, kirim, tandai; gagal → backoff eksponensial, tidak pernah menghapus alarm. **Pengiriman default mati** (flag `PAYMENT_ALERT_NOTIFY_ENABLED` kosong) sampai Founder menyetujui konfigurasi; secret hanya diisi Founder langsung di Netlify (tidak pernah dikirim lewat chat).

## 9. Risiko tersisa sebelum live

1. Belum ada notifikasi aktif/pull-verifikasi (B4.2); sebelum itu, refund/chargeback yang webhooknya hilang hanya terlihat saat operator membuka halaman dan Midtrans mengirim ulang.
2. Midtrans belum diuji end-to-end di sandbox (butuh domain produksi dengan kunci sandbox; Deploy Preview tidak bisa menerima webhook).
3. Race kecil P2 di penutupan invoice PENDING (B3) dan audit ganda saat notifikasi pertama paralel — tidak memengaruhi uang.
4. `user_profiles` grants luas (dibagi dengan UMKMpro) — perlu persetujuan terpisah.
5. Origin allowlist untuk redirect URL (B6) belum.
6. Resolver `fn_resolve_review_payment` belum punya pemanggil aplikasi; alarm REVIEW diselesaikan operator manual atau otomatis bila resolver dijalankan.

## B4.2
E-mail notifications for these alerts (outbox, Netlify Scheduled Function, off by default): see `docs/BILLING_B4_2_EMAIL_NOTIFICATIONS.md`.
