# AI Strategy smoke, tahap A

**Status: NOT ACTIVATED.** Kode dan workflow sudah ada, tetapi tidak ada key, Environment, atau variabel yang aktif. Tidak ada panggilan AI yang pernah dijalankan oleh dokumen ini.

## Tujuan
Membuktikan SATU hal: penyedia AI menerima skema generasi AI Strategy yang dikirim produk (`CampaignProposalGenerationSchema`, PR #176) dan mengembalikan proposal yang lolos skema simpan. Itu adalah risiko terbuka yang menahan deploy PR #176 ke production.

Yang TIDAK diuji di sini (butuh tahap B): kuota tenant, baris `prompter_ai_jobs`, provenance `ai_job_id`, penyimpanan ke database, Auth, billing.

## Kelas bukti
| Hal | Kelas |
|---|---|
| Harness (satu percobaan, tanpa bocor, kriteria lulus) | UNIT / MOCK (`tests/unit`, di CI, tanpa jaringan) |
| Penyedia menerima skema | REAL, hanya setelah workflow dijalankan manual DAN hasilnya PASS. Run yang FAIL atau error AUTH adalah percobaan nyata tetapi bukan bukti apa pun soal skema |
| Quality Gate atas salinan aktif | Informasi saja dalam smoke ini (aturannya sudah diuji UNIT di CI) |

## Apa yang dijalankan
- `lib/ai/smoke/strategy-smoke.ts`: memakai `CampaignProposalGenerationSchema`, `buildSystemPreamble`, `buildCampaignProposalPrompt`, dan `normalizeProposalAdditions` yang SAMA dengan produk. Panggilan lewat adaptor produk (`AnthropicProvider` atau `OpenAIProvider`), yang menserialkan skema Zod ke penyedia. Tidak ada skema tiruan.
- `tests/smoke/ai-strategy.smoke.test.ts`: satu uji nyata. Dijalankan hanya oleh `vitest.smoke.config.ts`, yang tidak pernah dipakai `npm test` maupun CI.
- Produk contoh fiktif ("Kopi Susu Aren Contoh LINOE"). Tidak ada data tenant atau pelanggan.

## Batas
| Batas | Nilai |
|---|---|
| Percobaan | tepat 1. Tanpa retry (`maxRetries: 0`, SDK retry mati), tanpa fallback. Runner sekali pakai |
| Token keluaran | maks. 4.000 (sama dengan bawaan produk) |
| Timeout | 45 detik per percobaan |
| Model | wajib diisi eksplisit, tanpa bawaan, agar biaya dipilih sadar |
| Kredensial | satu: key QA khusus. Run ditolak bila ada variabel produk/produksi (`OPENAI_API_KEY`, `SUPABASE_*`, `PAYMENT_*`, `META_*`, dll.) |
| Biaya | tidak bisa dihitung dari kode (tabel harga model kosong). Batas pasti ada di dashboard penyedia. Satu panggilan: keluaran maks. 4.000 token, ditambah token masukan (prompt produk yang panjang, ukurannya tidak dibatasi di sini). Biaya rupiah/dolar tidak diklaim |
| Validasi key | ditolak sebelum panggilan bila kosong, berspasi/berbaris baru, di luar 20-512 karakter ASCII tercetak, key Admin, atau key vendor lain. Hanya bentuk yang dicek, nilai tidak pernah dicetak. Nilai provider, model, dan key dibaca persis (tanpa dipangkas) |

## Apa yang diperiksa dari key, dan apa yang TIDAK
Terverifikasi dari dokumentasi resmi vendor (dicek 19 Nov 2026): key Anthropic diawali `sk-ant-`; key Admin Anthropic diawali `sk-ant-admin`. Bagian versi (misalnya `api03`), panjang, dan karakter TIDAK didokumentasikan, jadi tidak diasumsikan: kode tidak bergantung pada prefix versi tertentu.
OpenAI: dokumentasi yang dicek tidak mendefinisikan prefix key biasa (hanya contoh `sk-admin...` untuk key Admin). Awalan `sk-` dipakai sebagai syarat KONSERVATIF dan statusnya **TIDAK TERVERIFIKASI resmi**. Bila OpenAI mengubah format, smoke MENOLAK (gagal tertutup) dan perlu PR kecil untuk memperbarui pemeriksaan. Key Admin OpenAI dan key berawalan `sk-ant-` ditolak.
Batas 20-512 karakter hanyalah batas kewajaran terhadap tempelan sampah, bukan klaim format vendor.
Bentuk key tidak bisa membedakan key milik workspace dari key personal. Karena itu key HARUS dibuat khusus (workspace/project terpisah, batas pengeluaran rendah), lihat langkah 1.

## Kriteria lulus (semua wajib)
1. Tepat 1 percobaan dan tanpa kategori error.
2. Penyedia menerima skema (adaptor tidak melempar).
3. Hasil lolos `CampaignProposalSchema` (skema simpan) setelah `normalizeProposalAdditions`.
4. Tepat 3 kandidat.
5. `objective_recommendation` kosong atau salah satu nilai daftar.
6. `missing_facts` berupa daftar atau kosong.
7. Tidak ada URL, domain, atau nomor telepon di salinan aktif, menurut pola smoke DAN aturan `URL_IN_COPY` / `PHONE_IN_COPY` milik Quality Gate (satu definisi, bukan dua).

Dicatat sebagai INFORMASI, tidak menggagalkan smoke: (a) hasil Quality Gate atas salinan aktif (status, skor, ada tidaknya blokir, kode isu); (b) `rawInterestsAreText`, yaitu apakah teks minat mentah dari model bebas dari angka mirip ID. Produk memperbaikinya di kode, jadi ini hanya menunjukkan perilaku model. Pertanyaan smoke ini adalah penerimaan skema.

## Keamanan log
Laporan hanya berisi boolean, angka, nilai enum, dan KATEGORI error (`AUTH`, `RATE_LIMIT`, `API` + status HTTP, dst.). Untuk error non-penyedia (misalnya error parse SDK) hanya NAMA kelas error yang dicatat, bila berupa huruf biasa. Tidak pernah: key, pesan error penyedia, teks yang ditulis model. Ringkasan ditulis ke job summary GitHub.
Pengecualian SETELAH panggilan berbayar (bug di pemeriksaan, bentuk jawaban tak terduga) ditangkap: laporan hanya memuat jenis `POST_PROCESSING_ERROR` dan nama kelas. Uji nyata juga dibungkus agar vitest tidak mencetak pesan atau stack. Nama provider/model yang dilaporkan balik hanya disimpan bila berupa pengenal biasa.

## Aturan workflow (`.github/workflows/qa-ai-strategy-smoke.yml`)
- Hanya `workflow_dispatch`. Tanpa push, pull_request, atau schedule.
- Job jalan bila: dari `main`, variabel repo `AI_SMOKE_ENABLED == 'true'`, dan frasa `RUN-AI-STRATEGY-SMOKE-A` benar. Bila syarat ini tidak terpenuhi, job DILEWATI (skipped): itu BUKAN lulus dan bukan bukti apa pun.
- Anti false-green: provider di luar `anthropic`/`openai` membuat langkah penjaga GAGAL (teks tetap, tanpa secret dan tanpa panggilan). Langkah penutup `always()` menggagalkan job kecuali tepat satu langkah smoke berstatus success. Run hijau berarti satu smoke benar-benar lulus.
- Environment GitHub `qa-ai-smoke`. Checkout dan `npm ci` tidak menerima secret.
- Dua langkah smoke terpisah, satu per penyedia (`if: inputs.provider == ...`). Masing-masing hanya membawa secret penyedianya sendiri, tanpa ekspresi `a && secret1 || secret2`, sehingga key satu vendor tidak bisa terkirim ke vendor lain.
- Perlindungan sebenarnya terhadap branch lain adalah pembatasan Environment (lihat langkah 2), BUKAN kondisi `if` di berkas workflow: pemilik branch dengan akses tulis bisa mengubah berkas workflow di branch-nya lalu menjalankannya. Hanya pembatasan "Deployment branches = main" yang mencegah secret Environment diberikan ke run dari branch lain.
- Action dipin ke SHA penuh. Input lewat env, bukan disisipkan ke skrip shell.
- Tidak menyebut Supabase, Auth, billing, Netlify, Meta, atau Resend.

## Syarat SEBELUM secret apa pun dimasukkan (belum aktif)
Status proteksi saat ini: **TIDAK AKTIF dan tidak terverifikasi.** Environment `qa-ai-smoke` belum dibuat dan tidak ada key. Dokumen ini tidak mengklaim proteksi sudah ada. Kedua hal berikut harus selesai dan diverifikasi Founder di halaman Environment SEBELUM secret pertama ditambahkan:
1. Deployment branches and tags = Selected branches and tags = `main` saja. Tanpa ini, run dari branch lain bisa menerima secret Environment (kondisi `if` di berkas workflow bukan perlindungan, karena berkas itu bisa diubah di branch lain).
2. Required reviewers = Founder, dan opsi mencegah penyetuju menyetujui run yang ia mulai sendiri bila tersedia. Tiap run lalu butuh persetujuan manual sebelum secret diberikan.
Environment yang belum ada akan dibuat otomatis TANPA proteksi saat workflow berjalan; buat dan kunci dulu. Ketersediaan fitur ini bergantung pada paket GitHub repo: bila tidak tersedia, BERHENTI dan laporkan (BLOCKER), jangan lanjut tanpa proteksi.

## Risiko "Re-run jobs" (panggilan berbayar bisa terulang)
Tombol "Re-run jobs" / "Re-run failed jobs" di GitHub menjalankan ulang job yang sama dengan input dan secret yang sama, sehingga SATU klik = SATU panggilan AI berbayar tambahan. Batas "satu percobaan" di kode berlaku per proses, bukan per run GitHub. Aturan:
- Jangan klik Re-run pada run smoke. Untuk mencoba lagi, mulai Run workflow BARU dengan persetujuan Founder.
- Required reviewers (di atas) juga memaksa persetujuan pada tiap re-run.
- Tidak ada otomatisasi rerun di repo ini, dan tidak boleh dibuat. Menambah penjaga `github.run_attempt` adalah opsi yang belum disetujui dan belum dibuat.

## Cara pakai dari Android (setelah PR di-merge dan Founder menyetujui tiap langkah)
Tiap langkah menunggu frasa persetujuan terpisah dari Founder. Tidak ada langkah yang dijalankan otomatis.
1. Dashboard penyedia yang SUDAH punya kredit: buat satu key khusus QA di workspace/project terpisah dengan batas pengeluaran rendah. Jangan pakai atau salin key production. Jangan beli kredit atau buat akun baru. Bila belum ada kredit: berhenti (BLOCKER).
2. GitHub (browser Android) > Settings > Environments > New environment `qa-ai-smoke`, LALU sebelum menambah secret apa pun: "Deployment branches and tags" > "Selected branches and tags" > tambah `main`. Ini WAJIB. Required reviewers (Founder) juga WAJIB sebelum secret dimasukkan (lihat bagian Syarat di atas). Environment yang belum dibuat akan dibuat otomatis TANPA proteksi bila workflow dijalankan, jadi buat dan kunci dulu. Verifikasi: di halaman Environment, "Deployment branches" harus menampilkan `main` saja.
3. Di Environment itu tambah SATU secret untuk penyedia yang dipilih: `QA_AI_SMOKE_ANTHROPIC_API_KEY` (key harus berawalan `sk-ant-`) atau `QA_AI_SMOKE_OPENAI_API_KEY`. Jangan membuat secret dengan nama itu di tingkat repo (hanya di Environment).
4. Settings > Secrets and variables > Actions > Variables: `AI_SMOKE_ENABLED` = `true` (mempersenjatai). Setelah selesai, hapus atau set kembali ke bukan `true`.
5. Actions > "QA AI Strategy smoke A" > Run workflow dari `main`: pilih provider, isi ID model persis dari dashboard (jangan menebak), ketik `RUN-AI-STRATEGY-SMOKE-A`.
6. Buka run, lihat job summary: PASS atau FAIL, penyedia, model yang dilaporkan, jumlah token, kategori error bila ada.
7. Selesai: hapus secret dan matikan `AI_SMOKE_ENABLED`. Cabut key QA di dashboard penyedia bila tidak dipakai lagi.

## Bila gagal
Jangan jalankan ulang otomatis dan jangan klik Re-run. Laporkan "Failure kind" dari summary. Deploy PR #176 tetap HOLD sampai ada PASS.
| Failure kind | Arti yang TERBUKTI |
|---|---|
| `AUTH` | key salah, dicabut, atau tanpa kredit |
| `RATE_LIMIT` | dibatasi penyedia |
| `CONNECTION_OR_TIMEOUT` | jaringan atau timeout 45 detik |
| `REFUSAL` | penyedia menolak isi |
| `PROVIDER_SERVER_ERROR` | error server penyedia (5xx) |
| `PROVIDER_REJECTED_REQUEST_CAUSE_UNKNOWN` | penyedia menolak permintaan (4xx). Penyebab **UNKNOWN**: bisa skema, ID model salah, atau batas lain |
| `OUTPUT_UNUSABLE_CAUSE_UNKNOWN` | jawaban tidak bisa dipakai. Penyebab **UNKNOWN**: bisa skema, keluaran terpotong batas 4.000 token, atau bentuk tak sesuai |
| `POST_PROCESSING_ERROR` | panggilan berhasil, tetapi pemeriksaan smoke sendiri error (bug yang harus diperbaiki, bukan vonis penyedia) |
| `UNKNOWN` | di luar kategori di atas |
Adaptor produk tidak mengekspos alasan berhenti (stop reason) model, jadi penolakan skema, keluaran terpotong, dan jawaban tak sesuai TIDAK bisa dibedakan dari sini dan tidak pernah dilaporkan sebagai "skema ditolak". Bila sukses dan token keluaran mencapai 4.000, summary memberi catatan informasi bahwa jawaban mungkin terpotong. Laporkan apa adanya, jangan ditafsirkan sebagai lulus.

## Tahap B (tidak termasuk di sini)
Kuota, provenance, dan penyimpanan butuh project Supabase QA berskema dan environment aplikasi terpisah. Hanya dipertimbangkan setelah tahap A lulus dan atas persetujuan Founder.
