import type { ReturnKind } from "./sources";

export type Verification = "TERVERIFIKASI" | "SEBAGIAN" | "BELUM";
export type Actor = "APLIKASI" | "FOUNDER" | "AKUNTAN";

export interface GuideLink {
  readonly label: string;
  readonly href: string;
  /** internal = a page of this app; official = the DJP portal/docs (opened in a new tab). */
  readonly kind: "internal" | "official";
}

export interface GuideStep {
  readonly id: string;
  /** 1-based number within the chosen return type. */
  readonly n: number;
  readonly title: string;
  readonly actor: Actor;
  readonly why: string;
  readonly todo: readonly string[];
  readonly links: readonly GuideLink[];
  readonly sourceIds: readonly string[];
  readonly verification: Verification;
  readonly warning: string | null;
  /** Step that downloads the package (renders the export form). */
  readonly isPackage?: boolean;
  /** Last step: completion needs the two official proofs ticked, and is still not proof of filing. */
  readonly isFinal?: boolean;
}

type Base = Omit<GuideStep, "n"> & { readonly appliesTo: readonly ReturnKind[]; readonly ppn?: Partial<Omit<GuideStep, "n" | "id">> };

export const SECRETS_WARNING =
  "Jangan pernah mengetik atau membagikan kata sandi, OTP, kode otorisasi, atau passphrase Coretax di aplikasi ini, chat, atau ke siapa pun. LINOE tidak memintanya.";

const UNVERIFIED_NOTE = "Prosedur ini belum terverifikasi dari sumber resmi DJP yang dibaca untuk panduan ini. Ikuti petunjuk di Coretax atau Coretaxpedia, atau tanyakan ke KPP atau akuntan.";


const BASE: readonly Base[] = [
  {
    id: "identitas",
    title: "Periksa identitas dan akses Coretax",
    actor: "FOUNDER",
    appliesTo: ["PPH_BADAN", "PPN"],
    why: "Hanya penanggung jawab, wakil, atau kuasa yang dapat melapor atas nama PT, lewat akun mereka sendiri.",
    todo: [
      "NPWP PT Tanyopo Future Technology aktif dan data badan di Coretax sesuai akta dan data terbaru.",
      "Penanggung jawab, wakil, atau kuasa dapat masuk ke Coretax dengan akun sendiri.",
      "Setelah masuk, pilih NPWP badan pada dropdown (impersonate) agar bekerja atas nama PT.",
      "Rekening bank untuk pengembalian (jika ada lebih bayar) sudah benar di data Wajib Pajak.",
    ],
    links: [{ label: "Panduan resmi: login dan impersonate", href: "https://www.pajak.go.id/coretaxpedia/lapor-spt-tahunan-badan", kind: "official" }],
    sourceIds: ["S1"],
    verification: "SEBAGIAN",
    warning: "Syarat teknis akun (aktivasi akun, penyedia tanda tangan elektronik) tidak dirinci di halaman resmi yang dibaca. Pastikan sudah siap sebelum hari terakhir lapor.",
    ppn: { sourceIds: ["S2", "S3"], todo: [
      "NPWP PT aktif dan PT sudah dikukuhkan sebagai PKP (bukan sekadar berniat). Jika belum, SPT Masa PPN tidak berlaku.",
      "Penanggung jawab, wakil, atau kuasa dapat masuk ke Coretax, lalu memilih NPWP badan.",
      "Siapa yang menandatangani SPT Masa PPN sudah ditentukan.",
    ], links: [{ label: "Panduan resmi: SPT Masa PPN", href: "https://pajak.go.id/en/node/107920", kind: "official" }] },
  },
  {
    id: "periode",
    title: "Pilih tahun atau masa pajak",
    actor: "FOUNDER",
    appliesTo: ["PPH_BADAN", "PPN"],
    why: "Semua angka, tenggat, dan lampiran bergantung pada periode yang dilaporkan.",
    todo: [
      "Tentukan tahun pajak (jika tahun buku PT berbeda dari tahun kalender, konfirmasi ke akuntan).",
      "Batas lapor SPT Tahunan Badan: akhir bulan keempat setelah tahun pajak berakhir. Untuk tahun kalender: 30 April tahun berikutnya.",
      "Perpanjangan penyampaian dua bulan dapat diajukan, tetapi hanya untuk pelaporan, bukan untuk pembayaran. Pajak kurang bayar tetap harus dibayar.",
    ],
    links: [{ label: "Sumber resmi: batas waktu dan perpanjangan", href: "https://www.pajak.go.id/en/node/119763", kind: "official" }],
    sourceIds: ["S4"],
    verification: "TERVERIFIKASI",
    warning: null,
    ppn: {
      sourceIds: ["S3"],
      todo: [
        "Tentukan masa pajak (bulan). PKP wajib melapor SPT Masa PPN setiap bulan, termasuk jika nihil. Denda keterlambatan menurut DJP: Rp500 ribu per masa.",
      ],
      links: [{ label: "Sumber resmi: PKP wajib lapor, termasuk nihil", href: "https://www.pajak.go.id/en/node/119028", kind: "official" }],
      verification: "SEBAGIAN",
      warning: "Tanggal batas penyampaian SPT Masa PPN tidak disebut di sumber yang dibaca. Konfirmasi tanggalnya di Coretax, Coretaxpedia, atau ke KPP.",
    },
  },
  {
    id: "pembukuan",
    title: "Periksa kelengkapan pembukuan seluruh PT",
    actor: "APLIKASI",
    appliesTo: ["PPH_BADAN", "PPN"],
    why: "SPT adalah milik seluruh PT Tanyopo, bukan satu produk. Data LINOE hanyalah satu segmen.",
    todo: [
      "Semua aktivitas PT lain (produk, jasa, toko, bank, kas) sudah masuk ke pembukuan dan diverifikasi.",
      "Saldo awal berasal dari bukti nyata, bukan perkiraan.",
      "Rekonsiliasi bank selisih nol dan sudah disahkan.",
      "Akuntan sudah menyetujui daftar akun dan kebijakan pengakuan pendapatan.",
    ],
    links: [{ label: "Lihat rekonsiliasi bank", href: "/admin/finance/reports?r=bank", kind: "internal" }, { label: "Lihat buku besar", href: "/admin/finance/reports?r=buku-besar", kind: "internal" }],
    sourceIds: [],
    verification: "TERVERIFIKASI",
    warning: null,
  },
  {
    id: "faktur",
    title: "Periksa Faktur Pajak dan PPN masukan/keluaran",
    actor: "AKUNTAN",
    appliesTo: ["PPN"],
    why: "Menurut DJP, SPT Masa PPN dibuat otomatis dan data Faktur Pajak terposting ke dalamnya. Isinya bergantung pada Faktur Pajak di Coretax.",
    todo: [
      "Periksa di Coretax bahwa semua Faktur Pajak keluaran dan masukan masa ini sudah tercatat dan terposting ke SPT Masa PPN.",
      "Bandingkan total dengan pembukuan PT. LINOE belum menyimpan data Faktur Pajak, jadi pencocokan dilakukan manual atau oleh akuntan.",
    ],
    links: [{ label: "Panduan resmi: SPT Masa", href: "https://pajak.go.id/en/node/107920", kind: "official" }],
    sourceIds: ["S2"],
    verification: "SEBAGIAN",
    warning: "Cara pencocokan dan nama menu di Coretax tidak dirinci di sumber yang dibaca.",
  },
  {
    id: "laporan",
    title: "Periksa laporan laba rugi dan neraca",
    actor: "APLIKASI",
    appliesTo: ["PPH_BADAN"],
    why: "Laporan keuangan adalah dokumen pokok yang dibutuhkan untuk SPT Tahunan Badan.",
    todo: [
      "Laba rugi dan neraca seluruh PT sudah disusun dan neraca seimbang.",
      "Pengurus atau akuntan sudah memeriksa dan mengesahkan laporan. Laporan di aplikasi ini selalu berstatus draf.",
    ],
    links: [
      { label: "Laba rugi", href: "/admin/finance/reports?r=laba-rugi", kind: "internal" },
      { label: "Neraca", href: "/admin/finance/reports?r=neraca", kind: "internal" },
      { label: "Neraca saldo", href: "/admin/finance/reports?r=neraca-saldo", kind: "internal" },
    ],
    sourceIds: ["S1"],
    verification: "TERVERIFIKASI",
    warning: null,
  },
  {
    id: "fiskal",
    title: "Periksa rekonsiliasi fiskal",
    actor: "AKUNTAN",
    appliesTo: ["PPH_BADAN"],
    why: "Laba komersial dikoreksi menjadi laba fiskal. Hanya koreksi yang sudah diverifikasi akuntan yang dihitung.",
    todo: [
      "Koreksi fiskal positif dan negatif lengkap, ada buktinya, dan sudah diverifikasi.",
      "Kompensasi kerugian hanya dipakai jika terverifikasi.",
      "Angka segmen LINOE tidak dipakai sebagai angka SPT seluruh PT.",
    ],
    links: [{ label: "Buka rekap pajak", href: "/admin/finance/tax", kind: "internal" }],
    sourceIds: [],
    verification: "TERVERIFIKASI",
    warning: null,
  },
  {
    id: "hitung",
    title: "Periksa perhitungan pajak",
    actor: "AKUNTAN",
    appliesTo: ["PPH_BADAN"],
    why: "Tarif dan fasilitas pajak ditentukan akuntan. Aplikasi tidak pernah menebak tarif.",
    todo: [
      "Tarif dan fasilitas yang berlaku sudah dikonfirmasi akuntan.",
      "PPh yang masih harus dibayar dari perhitungan akuntan sama dengan yang tampil di formulir induk Coretax nanti.",
      "Kredit pajak (PPh 25, bukti potong/pungut) sudah dicocokkan dengan bukti.",
    ],
    links: [{ label: "Buka rekap pajak", href: "/admin/finance/tax", kind: "internal" }],
    sourceIds: ["S1"],
    verification: "SEBAGIAN",
    warning: "Halaman resmi hanya menyebut pemeriksaan nilai PPh terutang di formulir induk. Rincian kredit pajak tidak dibahas di sana.",
  },
  {
    id: "dokumen",
    title: "Siapkan dokumen dan lampiran",
    actor: "FOUNDER",
    appliesTo: ["PPH_BADAN", "PPN"],
    why: "Dokumen disiapkan sebelum membuka Coretax agar pengisian tidak terhenti.",
    todo: [
      "Laporan laba rugi dan laporan posisi keuangan (neraca).",
      "Bukti pemotongan atau pemungutan PPh dari lawan transaksi.",
      "Dokumen pendukung lain yang diminta akuntan.",
      "Simpan dokumen pajak hanya di tempat yang aman milik PT. Aplikasi ini tidak menyimpan dokumen pajak.",
    ],
    links: [{ label: "Sumber resmi: persiapan dokumen", href: "https://www.pajak.go.id/coretaxpedia/lapor-spt-tahunan-badan", kind: "official" }],
    sourceIds: ["S1"],
    verification: "TERVERIFIKASI",
    warning: null,
    ppn: {
      sourceIds: ["S2"],
      todo: ["Dokumen pendukung SPT Masa PPN adalah Faktur Pajak elektronik (e-Faktur).", "Dokumen lain sesuai arahan akuntan."],
      links: [{ label: "Sumber resmi: SPT Masa", href: "https://pajak.go.id/en/node/107920", kind: "official" }],
    },
  },
  {
    id: "paket",
    title: "Unduh Paket Coretax",
    actor: "APLIKASI",
    appliesTo: ["PPH_BADAN"],
    why: "Paket berisi PDF, Excel, CSV, dan manifest untuk akuntan sebagai bahan pengisian manual.",
    todo: [
      "Unduh paket lalu kirim ke akuntan untuk diperiksa.",
      "Paket bukan berkas impor Coretax dan tidak ada file XML. Angkanya diketik atau dicocokkan manual di Coretax.",
    ],
    links: [],
    sourceIds: [],
    verification: "TERVERIFIKASI",
    warning: "Paket yang dibuat saat data belum lengkap adalah draf dan tidak boleh dipakai sebagai angka SPT.",
    isPackage: true,
  },
  {
    id: "portal",
    title: "Buka portal Coretax resmi",
    actor: "FOUNDER",
    appliesTo: ["PPH_BADAN", "PPN"],
    why: "Login dilakukan sendiri oleh penanggung jawab di portal resmi. Aplikasi ini tidak pernah masuk atas nama Anda.",
    todo: [
      "Ketik atau buka alamat resmi coretaxdjp.pajak.go.id. Hindari tautan dari pesan atau iklan yang tidak dikenal.",
      "Masuk dengan akun sendiri lalu pilih NPWP badan.",
    ],
    links: [{ label: "Buka portal Coretax DJP", href: "https://coretaxdjp.pajak.go.id", kind: "official" }],
    sourceIds: ["S1"],
    verification: "TERVERIFIKASI",
    warning: "Jangan bagikan kata sandi, OTP, atau kode otorisasi kepada siapa pun, termasuk aplikasi ini.",
  },
  {
    id: "isi",
    title: "Ikuti panduan pengisian SPT",
    actor: "FOUNDER",
    appliesTo: ["PPH_BADAN", "PPN"],
    why: "Urutan resmi di Coretax harus diikuti persis.",
    todo: [
      "Buka Surat Pemberitahuan (SPT) > Surat Pemberitahuan (SPT) > Buat Konsep SPT.",
      "Pilih jenis PPh Badan, tentukan periode dan tahun pajak, pilih model normal, lalu Buat Konsep SPT.",
      "Isi formulir induk: jawab pertanyaan Ya/Tidak (menentukan lampiran wajib), pilih metode pembukuan, sektor usaha (Bagian B), dan sembilan pertanyaan Bagian H.",
      "Isi lampiran yang diwajibkan sistem.",
    ],
    links: [{ label: "Panduan resmi lengkap", href: "https://www.pajak.go.id/coretaxpedia/lapor-spt-tahunan-badan", kind: "official" }],
    sourceIds: ["S1"],
    verification: "TERVERIFIKASI",
    warning: null,
    ppn: {
      sourceIds: ["S2"],
      todo: [
        "Menurut DJP, SPT Masa PPN dibuat otomatis dan data Faktur Pajak terposting ke dalamnya. Periksa SPT PPN masa terkait di Coretax.",
      ],
      links: [{ label: "Panduan resmi: SPT Masa", href: "https://pajak.go.id/en/node/107920", kind: "official" }],
      verification: "BELUM",
      warning: UNVERIFIED_NOTE,
    },
  },
  {
    id: "validasi",
    title: "Periksa validasi dan kewajiban pembayaran",
    actor: "FOUNDER",
    appliesTo: ["PPH_BADAN", "PPN"],
    why: "Pastikan angka akhir dan jumlah yang harus dibayar benar sebelum menekan tombol kirim.",
    todo: [
      "Kembali ke formulir induk dan periksa PPh yang masih harus dibayar sesuai perhitungan akuntan.",
      "Baca semua pesan kesalahan atau peringatan yang ditampilkan Coretax dan selesaikan.",
      "Centang pernyataan (Bagian J) hanya jika Anda sudah yakin semua isi benar.",
    ],
    links: [{ label: "Panduan resmi", href: "https://www.pajak.go.id/coretaxpedia/lapor-spt-tahunan-badan", kind: "official" }],
    sourceIds: ["S1"],
    verification: "SEBAGIAN",
    warning: "Halaman resmi tidak menyebut langkah validasi terpisah, hanya pemeriksaan nilai PPh terutang dan pernyataan.",
    ppn: { sourceIds: ["S2"], verification: "BELUM", warning: UNVERIFIED_NOTE },
  },
  {
    id: "bayar",
    title: "Lakukan pembayaran jika diperlukan",
    actor: "FOUNDER",
    appliesTo: ["PPH_BADAN", "PPN"],
    why: "Jika kurang bayar, pajak harus dibayar. Pembayaran dilakukan sendiri oleh Anda, bukan oleh aplikasi.",
    todo: [
      "Klik Bayar dan Lapor di formulir induk.",
      "Pilih deposit pajak (jika saldo cukup) atau buat kode billing.",
      "Jika memakai kode billing, status SPT menjadi Menunggu Pembayaran dan baru Dilaporkan setelah pembayaran lunas.",
      "Perpanjangan penyampaian tidak memperpanjang tenggat pembayaran.",
    ],
    links: [{ label: "Sumber resmi: pembayaran", href: "https://www.pajak.go.id/coretaxpedia/lapor-spt-tahunan-badan", kind: "official" }],
    sourceIds: ["S1", "S4"],
    verification: "TERVERIFIKASI",
    warning: "Jika hasilnya nihil atau lebih bayar, langkah ini mungkin tidak ada.",
    ppn: { sourceIds: ["S2"], verification: "BELUM", warning: UNVERIFIED_NOTE },
  },
  {
    id: "kirim",
    title: "Tandatangani dan kirim SPT melalui Coretax",
    actor: "FOUNDER",
    appliesTo: ["PPH_BADAN", "PPN"],
    why: "Hanya orang yang berwenang yang boleh menandatangani. Penandatanganan terjadi di Coretax, bukan di aplikasi ini.",
    todo: [
      "Pilih penyedia tanda tangan, masukkan passphrase di Coretax, klik Simpan, lalu Konfirmasi Tanda Tangan.",
      "Passphrase dan kode apa pun hanya diketik di Coretax.",
    ],
    links: [{ label: "Sumber resmi: penandatanganan", href: "https://www.pajak.go.id/coretaxpedia/lapor-spt-tahunan-badan", kind: "official" }],
    sourceIds: ["S1"],
    verification: "SEBAGIAN",
    warning: "Halaman resmi menyebut passphrase dan penyedia tanda tangan, tidak menyebut kode otorisasi. Ikuti layar Coretax apa adanya.",
    ppn: { sourceIds: ["S2"], verification: "BELUM", warning: UNVERIFIED_NOTE },
  },
  {
    id: "bukti",
    title: "Simpan bukti pembayaran dan Bukti Penerimaan Elektronik",
    actor: "FOUNDER",
    appliesTo: ["PPH_BADAN", "PPN"],
    why: "Bukti resmi dari DJP adalah satu-satunya bukti bahwa SPT diterima. Checklist di sini bukan bukti.",
    todo: [
      "Unduh dan simpan Bukti Penerimaan Elektronik (BPE) SPT dari Coretax.",
      "Simpan bukti pembayaran (mis. NTPN) jika ada pembayaran.",
      "Simpan di penyimpanan aman milik PT, bukan di aplikasi ini.",
    ],
    links: [],
    sourceIds: ["S1"],
    verification: "BELUM",
    warning: UNVERIFIED_NOTE + " Halaman resmi yang dibaca hanya mencantumkan BPE sebagai judul FAQ terpisah.",    ppn: { sourceIds: [] },
  },
  {
    id: "selesai",
    title: "Tandai selesai setelah bukti resmi diverifikasi",
    actor: "FOUNDER",
    appliesTo: ["PPH_BADAN", "PPN"],
    why: "Tandai selesai hanya setelah Anda melihat status Dilaporkan dan BPE di Coretax.",
    todo: [],
    links: [],
    sourceIds: ["S1"],
    verification: "SEBAGIAN",
    warning: "Tanda selesai hanya catatan pribadi di perangkat ini. Itu bukan bukti pelaporan dan tidak dikirim ke DJP maupun ke server.",
    isFinal: true,
    ppn: { sourceIds: [], verification: "BELUM", warning: UNVERIFIED_NOTE + " Tanda selesai hanya catatan pribadi di perangkat ini, bukan bukti pelaporan." },
  },
];

export function stepsFor(kind: Exclude<ReturnKind, "LAINNYA">): GuideStep[] {
  const out: GuideStep[] = [];
  for (const b of BASE) {
    if (!b.appliesTo.includes(kind)) continue;
    const { appliesTo, ppn, ...rest } = b;
    void appliesTo;
    const merged = kind === "PPN" && ppn ? { ...rest, ...ppn } : rest;
    out.push({ ...merged, n: out.length + 1 });
  }
  return out;
}

/** Statutory annual deadline for a calendar-year taxpayer: end of the 4th month after year end (S4). */
export function annualFilingDeadline(year: string): string | null {
  if (!/^\d{4}$/.test(year)) return null;
  return `${Number(year) + 1}-04-30`;
}
