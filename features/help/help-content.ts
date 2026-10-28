import { FAQS } from "@/features/marketing/faq-data";
import { LEGAL } from "@/features/legal/legal-meta";
import { PLAN_TIERS, type PlanTierConfig } from "@/lib/billing/plans";

/**
 * Pusat Bantuan (/help) — content only. No fetching, no database, no AI.
 *
 * Sources of truth (never copied by hand, so this page cannot drift from them):
 *  - landing FAQ        -> features/marketing/faq-data.ts (FAQS)
 *  - prices and limits  -> lib/billing/plans.ts (PLAN_TIERS)
 *  - contact / operator -> features/legal/legal-meta.ts (LEGAL)
 *
 * Accuracy rules (same as legal-meta.ts): no SLA / response-time promise, no
 * retention period, no certification, no server location. Online payment is
 * NOT live and paid-ad publishing is NOT live; nothing here may say otherwise.
 */

export type HelpCategoryId =
  | "mulai"
  | "trial"
  | "paket"
  | "akun"
  | "koneksi"
  | "iklan"
  | "pembayaran"
  | "refund"
  | "privasi"
  | "kontak";

/** Availability of the capability an article talks about. Omitted = a plain how-to / policy note. */
export type HelpStatus = "AVAILABLE" | "IN_DEVELOPMENT" | "AWAITING_PLATFORM";

export const HELP_STATUS_LABEL: Record<HelpStatus, string> = {
  AVAILABLE: "Sudah tersedia",
  IN_DEVELOPMENT: "Dalam pengembangan",
  AWAITING_PLATFORM: "Menunggu persetujuan platform",
};

export interface HelpCategory {
  id: HelpCategoryId;
  title: string;
  summary: string;
}

export interface HelpLink {
  href: string;
  label: string;
}

export interface HelpArticle {
  id: string;
  category: HelpCategoryId;
  question: string;
  /** Plain text. Rendered as paragraphs split on blank lines, and indexed by the search. */
  answer: string;
  status?: HelpStatus;
  link?: HelpLink;
}

export const HELP_CATEGORIES: readonly HelpCategory[] = [
  { id: "mulai", title: "Memulai dengan LINOE", summary: "Apa itu LINOE dan cara mulai." },
  { id: "trial", title: "Trial gratis 14 hari", summary: "Isi, batas, dan setelah trial berakhir." },
  { id: "paket", title: "Paket & batas", summary: "Harga dan batas tiap paket." },
  { id: "akun", title: "Akun & onboarding", summary: "Daftar, masuk, dan menyiapkan workspace." },
  { id: "koneksi", title: "Koneksi media sosial", summary: "Facebook, Instagram, TikTok, dan X." },
  { id: "iklan", title: "Kesiapan & batasan iklan", summary: "Apa yang sudah dan belum bisa untuk iklan." },
  { id: "pembayaran", title: "Penagihan & status pembayaran", summary: "Status pembayaran online saat ini." },
  { id: "refund", title: "Refund & pembatalan", summary: "Pembatalan langganan dan pengajuan refund." },
  { id: "privasi", title: "Privasi & penghapusan data", summary: "Data Anda dan cara meminta penghapusan." },
  { id: "kontak", title: "Hubungi dukungan", summary: "Kirim email ke tim kami." },
] as const;

/**
 * Where each landing-FAQ question is filed. Keyed by the exact question text.
 * A question added to FAQS later and not listed here still shows up (under
 * "Memulai"), so the Help Center can never silently drop an FAQ answer.
 */
const FAQ_CATEGORY_BY_QUESTION: Record<string, HelpCategoryId> = {
  "Apa itu LINOE?": "mulai",
  "Siapa yang cocok menggunakan LINOE?": "mulai",
  "Siapa pengembang LINOE?": "mulai",
  "Bisakah saya pakai tanpa UMKMpro AI?": "mulai",
  "Apakah AI mengontrol budget iklan saya?": "iklan",
  "Platform marketing apa saja yang didukung?": "koneksi",
  "Apakah saya bisa meninjau dan menyetujui campaign?": "iklan",
  "Bisakah bisnis internasional menggunakannya?": "mulai",
};

/** Status shown next to an FAQ answer; only where the FAQ text itself makes the status clear. */
const FAQ_STATUS_BY_QUESTION: Record<string, HelpStatus> = {
  "Apakah AI mengontrol budget iklan saya?": "IN_DEVELOPMENT",
  "Apakah saya bisa meninjau dan menyetujui campaign?": "IN_DEVELOPMENT",
  "Platform marketing apa saja yang didukung?": "AWAITING_PLATFORM",
};

const idr = new Intl.NumberFormat("id-ID");
const formatIdr = (n: number) => `Rp${idr.format(n)}`;

function limitText(label: string, value: number | null): string {
  return value === null ? `${label}: lebih tinggi (angka pastinya belum ditetapkan)` : `${label}: ${idr.format(value)}`;
}

function planAnswer(plan: PlanTierConfig): string {
  const price =
    plan.priceIDR === 0
      ? `Gratis selama ${plan.pricePeriodLabel}.`
      : `${formatIdr(plan.priceIDR)} ${plan.pricePeriodLabel}${plan.isPriceTarget ? " (harga target, belum final)" : ""}.`;
  const lines = [
    `${plan.targetDescription} ${price}`,
    [
      limitText("Penggunaan AI", plan.limits.aiUsageAllowance),
      limitText("Produk aktif", plan.limits.maxActiveProducts),
      limitText("Campaign aktif", plan.limits.maxActiveCampaigns),
      limitText("Pengguna", plan.limits.maxUsers),
    ].join(" · "),
  ];
  if (plan.coreFeatures.length > 0) lines.push(`Fitur utama: ${plan.coreFeatures.join("; ")}.`);
  if (plan.comingSoonFeatures.length > 0) {
    lines.push(`Belum tersedia (dalam pengembangan): ${plan.comingSoonFeatures.join("; ")}.`);
  }
  if (plan.availability === "COMING_SOON") lines.push("Paket ini belum dibuka.");
  return lines.join("\n\n");
}

const FAQ_ARTICLES: HelpArticle[] = FAQS.map((f, i) => ({
  id: `faq-${i + 1}`,
  category: FAQ_CATEGORY_BY_QUESTION[f.q] ?? "mulai",
  question: f.q,
  answer: f.a,
  status: FAQ_STATUS_BY_QUESTION[f.q],
}));

const PLAN_ARTICLES: HelpArticle[] = PLAN_TIERS.filter((p) => p.id !== "FREE").map((p) => ({
  id: `paket-${p.id.toLowerCase()}`,
  category: "paket",
  question: `Paket ${p.name}: harga dan batasnya?`,
  answer: planAnswer(p),
  status: p.availability === "COMING_SOON" ? "IN_DEVELOPMENT" : undefined,
}));

const FREE_PLAN = PLAN_TIERS.find((p) => p.id === "FREE");

const CONTACT_SUBJECT = "Bantuan LINOE";
export const SUPPORT_MAILTO = `mailto:${LEGAL.contactEmail}?subject=${encodeURIComponent(CONTACT_SUBJECT)}`;

const HAND_WRITTEN_ARTICLES: HelpArticle[] = [
  {
    id: "mulai-langkah",
    category: "mulai",
    question: "Bagaimana cara mulai memakai LINOE?",
    answer:
      "1. Daftar akun di halaman Daftar, lalu masuk.\n\n2. Selesaikan onboarding singkat untuk menyiapkan workspace Anda.\n\n3. Tambahkan produk Anda, lalu minta LINOE menyusun strategi dan konten.\n\n4. Tinjau hasilnya dan setujui sendiri sebelum dipakai. Tidak ada yang berjalan tanpa persetujuan Anda.",
    status: "AVAILABLE",
    link: { href: "/register", label: "Daftar sekarang" },
  },
  {
    id: "trial-isi",
    category: "trial",
    question: "Apa yang saya dapat di trial gratis 14 hari?",
    answer: FREE_PLAN
      ? `Setiap workspace mendapat satu masa uji coba ${FREE_PLAN.pricePeriodLabel} tanpa biaya dan tanpa kartu kredit. Batas trial: ${idr.format(FREE_PLAN.limits.aiUsageAllowance)} penggunaan AI, ${FREE_PLAN.limits.maxActiveProducts} produk aktif, ${FREE_PLAN.limits.maxActiveCampaigns} campaign aktif, ${FREE_PLAN.limits.maxUsers} pengguna.\n\nFitur trial: ${FREE_PLAN.coreFeatures.join("; ")}.`
      : "Setiap workspace mendapat satu masa uji coba 14 hari tanpa biaya dan tanpa kartu kredit.",
    status: "AVAILABLE",
  },
  {
    id: "trial-berakhir",
    category: "trial",
    question: "Apa yang terjadi saat trial berakhir atau kuota AI habis?",
    answer:
      "Setelah masa trial berakhir, fitur AI dijeda sementara. Pembayaran online belum tersedia, jadi belum ada cara berlangganan lewat LINOE saat ini. Bila kuota penggunaan AI habis, Anda akan melihat pemberitahuan di aplikasi dan fitur AI berhenti sampai kuota tersedia lagi.",
  },
  {
    id: "akun-daftar",
    category: "akun",
    question: "Bagaimana cara mendaftar, masuk, atau reset kata sandi?",
    answer:
      "Daftar dan masuk lewat halaman Daftar dan Masuk. Bila lupa kata sandi, pakai tautan “Lupa kata sandi” di halaman Masuk. Tim LINOE tidak pernah meminta kata sandi Anda lewat email atau pesan.",
    status: "AVAILABLE",
    link: { href: "/login", label: "Ke halaman Masuk" },
  },
  {
    id: "akun-onboarding",
    category: "akun",
    question: "Apa itu onboarding dan apakah wajib?",
    answer:
      "Onboarding adalah beberapa langkah singkat setelah Anda mendaftar untuk menyiapkan workspace dan profil bisnis Anda, supaya rekomendasi AI sesuai dengan bisnis Anda.",
    status: "AVAILABLE",
  },
  {
    id: "akun-owner",
    category: "akun",
    question: "Siapa yang bisa mengelola koneksi dan pengaturan penting?",
    answer:
      "Pengelolaan koneksi platform (menyambungkan, memutus, memilih akun iklan) dilakukan oleh Owner workspace. Peran lain tidak dapat mengubahnya.",
  },
  {
    id: "koneksi-cara",
    category: "koneksi",
    question: "Bagaimana cara menghubungkan Facebook, Instagram, TikTok, atau X?",
    answer:
      "Buka halaman Koneksi di aplikasi, lalu pilih platform yang ingin dihubungkan dan ikuti izin dari platform tersebut. Facebook dan Instagram terhubung lewat satu koneksi Meta. Untuk memutus koneksi, gunakan halaman yang sama; cabut juga izin aplikasi di pengaturan platform Anda.",
    status: "AVAILABLE",
  },
  {
    id: "koneksi-akun-iklan",
    category: "koneksi",
    question: "Saya punya lebih dari satu akun iklan Meta. Bagaimana memilih yang benar?",
    answer:
      "Di kartu Facebook & Instagram pada halaman Koneksi, Owner dapat memilih akun iklan, lalu menjalankan “Periksa Kesiapan”. LINOE tidak memilihkan otomatis. Memilih akun hanya menyimpan pilihan: tidak membuat iklan dan tidak mengeluarkan biaya. Pemeriksaan kesiapan hanya membaca data dari Meta.",
    status: "AVAILABLE",
  },
  {
    id: "iklan-publikasi",
    category: "iklan",
    question: "Apakah LINOE sudah bisa menayangkan iklan berbayar?",
    answer:
      "Belum. Publikasi iklan berbayar otomatis masih dalam pengembangan. Untuk Meta (Facebook & Instagram), penayangan iklan berbayar masih menunggu persetujuan platform. Untuk TikTok dan X, publikasi campaign masih dalam pengembangan. LINOE saat ini membantu menyiapkan strategi, konten, dan rencana campaign.",
    status: "AWAITING_PLATFORM",
  },
  {
    id: "iklan-biaya",
    category: "iklan",
    question: "Apakah langganan LINOE sudah termasuk biaya iklan?",
    answer:
      "Tidak. Langganan LINOE terpisah dari biaya tayang iklan di platform iklan. LINOE tidak membaca saldo atau batas belanja akun iklan Anda, dan tidak ada iklan berbayar yang ditayangkan oleh LINOE saat ini.",
  },
  {
    id: "iklan-fitur-lanjut",
    category: "iklan",
    question: "Fitur iklan dan analitik apa yang belum tersedia?",
    answer:
      "Sedang dalam pengembangan: atribusi dan analitik lanjutan, A/B testing dan retargeting, laporan/ekspor, serta otomasi lanjutan. Status setiap fitur ditampilkan apa adanya di aplikasi.",
    status: "IN_DEVELOPMENT",
  },
  {
    id: "bayar-status",
    category: "pembayaran",
    question: "Apakah saya bisa membayar langganan sekarang?",
    answer:
      "Belum. Pembayaran online di LINOE masih dalam tahap uji coba (sandbox). Belum ada penagihan atau pembayaran riil lewat LINOE. Harga di halaman ini adalah harga paket yang direncanakan; pembayaran akan diumumkan setelah diaktifkan.",
    status: "IN_DEVELOPMENT",
    link: { href: "/refund", label: "Baca Kebijakan Refund" },
  },
  {
    id: "bayar-kartu",
    category: "pembayaran",
    question: "Apakah saya perlu memasukkan kartu kredit?",
    answer: "Tidak. Trial 14 hari tanpa kartu kredit, dan saat ini LINOE belum menerima pembayaran riil.",
  },
  {
    id: "refund-batal",
    category: "refund",
    question: "Bagaimana cara membatalkan langganan?",
    answer:
      "Bila langganan berbayar sudah tersedia, Anda dapat membatalkan perpanjangan kapan saja. Setelah dibatalkan, langganan tidak diperpanjang dan akses tetap berlaku sampai akhir periode yang sudah dibayar. Pembatalan perpanjangan tidak otomatis mengembalikan pembayaran untuk periode yang sedang berjalan.",
    link: { href: "/refund", label: "Kebijakan Refund lengkap" },
  },
  {
    id: "refund-ajukan",
    category: "refund",
    question: "Bagaimana cara mengajukan refund?",
    answer: `Karena belum ada pembayaran riil, saat ini belum ada pembayaran yang dapat dikembalikan. Setelah pembayaran aktif, kirim email ke ${LEGAL.contactEmail} dengan subjek “Permohonan Refund LINOE”, berisi email akun, tanggal dan jumlah pembayaran, paket, dan alasan. Pengajuan diperiksa satu per satu dan diproses manual; tidak otomatis disetujui.`,
    link: { href: "/refund", label: "Kebijakan Refund lengkap" },
  },
  {
    id: "privasi-data",
    category: "privasi",
    question: "Bagaimana LINOE memproses data saya, termasuk oleh AI?",
    answer:
      "Sebagian teks yang Anda masukkan diteruskan ke penyedia AI pihak ketiga untuk menghasilkan jawaban. Jangan memasukkan data rahasia, kata sandi, atau token ke dalam LINOE. Rincian lengkap ada di Kebijakan Privasi.",
    link: { href: "/privacy", label: "Kebijakan Privasi" },
  },
  {
    id: "privasi-hapus",
    category: "privasi",
    question: "Bagaimana cara meminta penghapusan data saya?",
    answer: `LINOE belum punya tombol hapus akun otomatis. Kirim email ke ${LEGAL.contactEmail} dengan subjek “Permintaan Penghapusan Data LINOE”, berisi email akun dan data yang ingin dihapus. Permintaan diverifikasi lalu ditangani manual. Anda juga dapat memutus koneksi platform sendiri dari halaman Koneksi.`,
    link: { href: "/data-deletion", label: "Penghapusan Data Pengguna" },
  },
  {
    id: "kontak-email",
    category: "kontak",
    question: "Bagaimana menghubungi tim dukungan?",
    answer: `Kirim email ke ${LEGAL.contactEmail}. Sebutkan email akun Anda dan jelaskan masalahnya (lampirkan tangkapan layar bila ada). Jangan pernah mengirim kata sandi atau token. Halaman ini tidak menetapkan jangka waktu balasan.`,
    link: { href: SUPPORT_MAILTO, label: "Kirim email ke dukungan" },
  },
  {
    id: "kontak-prioritas",
    category: "kontak",
    question: "Apakah ada dukungan prioritas atau chat langsung?",
    answer:
      "Dukungan prioritas per paket dan layanan chat belum tersedia dan masih dalam pengembangan. Saat ini kanal dukungan resmi adalah email.",
    status: "IN_DEVELOPMENT",
  },
];

export const HELP_ARTICLES: readonly HelpArticle[] = [...FAQ_ARTICLES, ...HAND_WRITTEN_ARTICLES, ...PLAN_ARTICLES];
