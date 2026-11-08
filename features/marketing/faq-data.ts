import { LEGAL } from "@/features/legal/legal-meta";

/**
 * Single source of truth for the landing FAQ. Rendered by sections/faq.tsx AND
 * serialised into FAQPage JSON-LD (lib/seo/json-ld.ts), so the structured data
 * can never drift from what visitors actually see.
 */
export const FAQS = [
  {
    q: "Apa itu LINOE?",
    a: "Tim marketing AI yang membantu memahami produk Anda, menyusun strategi, membuat konten, menyiapkan campaign, menganalisis hasil, dan terus mengoptimasi — dengan Anda tetap memegang kendali penuh.",
  },
  {
    q: "Siapa yang cocok menggunakan LINOE?",
    a: "LINOE dirancang untuk membantu UMKM, pemilik bisnis, dan tim pemasaran merencanakan serta menyiapkan promosi dengan bantuan AI.",
  },
  {
    q: "Siapa pengembang LINOE?",
    a: "LINOE dikembangkan oleh PT Tanyopo Future Technology, perusahaan teknologi yang berlokasi di Aceh Selatan, Indonesia.",
  },
  {
    q: "Bisakah saya pakai tanpa UMKMpro AI?",
    a: "Bisa. Integrasi dengan UMKMpro AI sepenuhnya opsional. Anda bisa menambahkan produk secara langsung dan menggunakan seluruh fitur LINOE sebagai bisnis mandiri.",
  },
  {
    q: "Apakah AI mengontrol budget iklan saya?",
    a: "Tidak. AI hanya menyusun rekomendasi budget. Budget Guard menjaga batas yang Anda tentukan, dan aksi penting tetap menunggu persetujuan Anda. Publikasi iklan berbayar secara otomatis masih dalam pengembangan.",
  },
  {
    q: "Platform marketing apa saja yang didukung?",
    a: "Anda dapat menghubungkan akun Facebook, Instagram, TikTok, dan X, serta menyusun strategi untuk website/SEO. Persiapan campaign tersedia. Untuk Meta (Facebook & Instagram), publikasi campaign berbayar masih menunggu persetujuan platform. Untuk TikTok dan X, publikasi campaign masih dalam pengembangan. Status tiap platform selalu ditampilkan apa adanya.",
  },
  {
    q: "Apakah saya bisa meninjau dan menyetujui campaign?",
    a: "Ya. LINOE membantu menyiapkan campaign, lalu Anda meninjau, mengedit, atau meminta regenerasi lewat Approval Center. Publikasi otomatis iklan berbayar masih dalam pengembangan, sehingga LINOE tidak menayangkan iklan berbayar secara otomatis.",
  },
  {
    q: "Bisakah bisnis internasional menggunakannya?",
    a: "Ya. Arsitektur Global Edition mendukung banyak bahasa, mata uang, dan zona waktu — target pasar campaign Anda bisa berbeda dari negara asal bisnis Anda.",
  },
  {
    q: "Berapa harga LINOE?",
    a: "Setiap workspace baru mendapat trial gratis 14 hari. Paket berbayar direncanakan mulai dari Rp99.000 per bulan (Starter); daftar paket lengkap ada di bagian Harga. Pembayaran online belum aktif, jadi saat ini belum ada penagihan melalui LINOE.",
  },
  {
    q: "Bagaimana cara kerja trial 14 hari?",
    a: "Setiap workspace baru mendapat masa coba 14 hari tanpa biaya dan tanpa kartu kredit. Sisa hari trial ditampilkan di dalam aplikasi. Setelah trial berakhir, fitur AI dijeda karena pembayaran online belum aktif.",
  },
  {
    q: "Bagaimana kebijakan refund?",
    a: `Karena pembayaran online belum aktif, saat ini belum ada pembayaran yang dapat dikembalikan. Jika nanti ada pembayaran riil, refund diajukan lewat email ke ${LEGAL.contactEmail} dan diproses secara manual oleh tim kami; pengajuan diperiksa satu per satu dan tidak otomatis disetujui. Selengkapnya ada di halaman Kebijakan Refund.`,
  },
  {
    q: "Bagaimana cara menghubungi dukungan LINOE?",
    a: `Kirim email ke ${LEGAL.contactEmail}. Sertakan email akun Anda dan penjelasan singkat masalahnya agar kami lebih mudah membantu.`,
  },
];
