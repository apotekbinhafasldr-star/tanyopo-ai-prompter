import Link from "next/link";
import { LegalDocument, LegalList, LegalSection, PendingDecision } from "@/features/legal/legal-parts";
import { LEGAL, legalMetadata } from "@/features/legal/legal-meta";

export const metadata = legalMetadata({
  title: "Syarat & Ketentuan",
  description:
    "Syarat penggunaan LINOE by Tanyopo: akun, uji coba gratis, paket dan pembayaran, konten AI, kebijakan platform iklan, dan larangan penyalahgunaan.",
  path: "/terms",
});

const TOC = [
  { id: "layanan", title: "Layanan dan akun" },
  { id: "uji-coba", title: "Uji coba gratis" },
  { id: "paket", title: "Paket, pembayaran, dan pembatalan" },
  { id: "ai", title: "Konten AI dan tanggung jawab Anda" },
  { id: "iklan", title: "Platform iklan" },
  { id: "larangan", title: "Larangan" },
  { id: "batas", title: "Batas layanan dan perubahan" },
  { id: "kontak", title: "Kontak dan hukum yang berlaku" },
];

export default function TermsPage() {
  return (
    <LegalDocument
      title="Syarat & Ketentuan"
      intro="Dengan membuat akun atau menggunakan LINOE, Anda menggunakan layanan yang dioperasikan oleh perusahaan kami berdasarkan syarat berikut. Mohon baca dengan saksama."
      toc={TOC}
      current="/terms"
    >
      <LegalSection id="layanan" title="1. Layanan dan akun">
        <p>
          {LEGAL.product} adalah platform pemasaran berbantuan AI yang dioperasikan oleh {LEGAL.operator} ({LEGAL.location}).
          Layanan mencakup analisis produk, penyusunan strategi dan konten, perencanaan campaign, dan pemantauan hasil.
        </p>
        <LegalList
          items={[
            "Anda harus memberikan data pendaftaran yang benar dan menjaga kerahasiaan kata sandi Anda.",
            "Anda bertanggung jawab atas aktivitas yang terjadi di akun Anda.",
            "Pemilik akun (owner) mengelola data bisnis, koneksi platform, dan paket langganan.",
            "Anda harus berwenang menggunakan data, merek, dan materi yang Anda masukkan ke LINOE.",
          ]}
        />
      </LegalSection>

      <LegalSection id="uji-coba" title="2. Uji coba gratis">
        <p>Akun baru mendapat uji coba gratis dengan batas berikut yang diterapkan oleh sistem:</p>
        <LegalList
          items={[
            "masa uji coba 14 hari sejak akun mulai digunakan;",
            "30 penggunaan AI selama seluruh masa uji coba;",
            "hingga 3 produk aktif, 2 campaign aktif, dan 1 pengguna.",
          ]}
        />
        <p>
          Setelah masa uji coba berakhir atau batas tercapai, fitur yang dibatasi tidak dapat digunakan sampai Anda
          berlangganan. Uji coba dimaksudkan satu kali untuk satu bisnis. Kami dapat membatasi, menangguhkan, atau
          menolak uji coba yang diduga dibuat berulang, melalui banyak akun, atau dengan cara menghindari batas yang
          berlaku.
        </p>
        <PendingDecision>
          Apakah dan bagaimana data uji coba disimpan atau dihapus setelah masa uji coba berakhir tanpa berlangganan.
        </PendingDecision>
      </LegalSection>

      <LegalSection id="paket" title="3. Paket, pembayaran, dan pembatalan">
        <p>
          Paket berbayar, harga, dan batasnya ditampilkan di halaman harga dan dapat berubah; harga yang berlaku adalah
          yang tertera saat Anda berlangganan. Beberapa paket dapat berstatus “segera hadir”.
        </p>
        <p>
          Pada saat draf ini ditulis, pemrosesan pembayaran sungguhan belum diaktifkan. Ketentuan di bawah ini akan
          berlaku ketika pembayaran diaktifkan.
        </p>
        <PendingDecision>
          Metode dan siklus penagihan, kebijakan pembatalan (misalnya berhenti pada akhir periode), kebijakan
          pengembalian dana (refund), pajak, serta perlakuan keterlambatan pembayaran. Tidak ada janji pengembalian
          dana yang dibuat dalam draf ini.
        </PendingDecision>
      </LegalSection>

      <LegalSection id="ai" title="4. Konten AI dan tanggung jawab Anda">
        <LegalList
          items={[
            "Konten yang dihasilkan AI dapat tidak akurat, tidak lengkap, atau mirip dengan konten lain. Anda wajib meninjaunya sebelum digunakan atau dipublikasikan.",
            "Anda bertanggung jawab atas klaim produk, harga, testimoni, dan materi iklan yang Anda gunakan, serta atas kepatuhannya pada hukum dan aturan periklanan.",
            "Kami tidak menjamin hasil bisnis tertentu — termasuk penjualan, jangkauan, atau performa iklan — dari penggunaan LINOE.",
            "Jangan memasukkan data pribadi pihak lain atau informasi rahasia ke kolom yang diproses AI, kecuali Anda berhak dan perlu melakukannya.",
          ]}
        />
        <p>
          Hak atas konten yang Anda masukkan tetap pada Anda. Anda memberi kami izin terbatas untuk memproses konten itu
          semata-mata untuk menyediakan layanan kepada Anda.
        </p>
        <PendingDecision>Kepemilikan dan lisensi atas hasil keluaran AI secara hukum, menurut penasihat hukum.</PendingDecision>
      </LegalSection>

      <LegalSection id="iklan" title="5. Platform iklan">
        <LegalList
          items={[
            "Menghubungkan Meta, TikTok, atau X adalah pilihan Anda dan tunduk pada syarat serta kebijakan iklan masing-masing platform. Anda wajib mematuhinya.",
            "Platform dapat menolak iklan, membatasi akun, atau mengubah akses API kapan saja; kami tidak bertanggung jawab atas keputusan platform tersebut.",
            "Anggaran dan pembelanjaan iklan berada di akun iklan Anda dan menjadi tanggung jawab Anda.",
            "Kemampuan LINOE untuk meluncurkan atau mengubah anggaran iklan di platform eksternal dibatasi dan dapat belum tersedia; fitur ini hanya berjalan bila diaktifkan dan Anda menyetujuinya.",
          ]}
        />
      </LegalSection>

      <LegalSection id="larangan" title="6. Larangan">
        <p>Anda dilarang menggunakan LINOE untuk:</p>
        <LegalList
          items={[
            "spam, pesan massal tanpa izin, atau konten menyesatkan;",
            "penipuan, pemalsuan identitas, atau klaim palsu tentang produk;",
            "melanggar hukum, hak kekayaan intelektual, atau hak pihak lain;",
            "mendaftar berulang atau memakai banyak akun untuk menghindari batas uji coba atau kuota;",
            "mengakali, memanipulasi, atau mengakses sistem tanpa izin, termasuk menghindari batas penggunaan atau mengakses data bisnis lain;",
            "membebani layanan secara berlebihan atau menggunakan layanan secara otomatis tanpa persetujuan kami.",
          ]}
        />
        <p>Pelanggaran dapat berakibat pembatasan, penangguhan, atau penutupan akun.</p>
      </LegalSection>

      <LegalSection id="batas" title="7. Batas layanan dan perubahan">
        <LegalList
          items={[
            "Layanan diberikan sebagaimana adanya; kami berupaya menjaga ketersediaannya tetapi tidak menjamin layanan selalu tanpa gangguan.",
            "Fitur, batas, dan harga dapat berubah. Perubahan material akan diinformasikan melalui aplikasi atau email.",
            "Dengan tetap menggunakan layanan setelah perubahan berlaku, Anda dianggap menerima syarat yang diperbarui.",
          ]}
        />
        <PendingDecision>Batas tanggung jawab (limitation of liability) dan ganti rugi, untuk ditetapkan bersama penasihat hukum.</PendingDecision>
      </LegalSection>

      <LegalSection id="kontak" title="8. Kontak dan hukum yang berlaku">
        <p>
          Pengelolaan data pribadi diatur dalam{" "}
          <Link href="/privacy" className="font-medium text-brand hover:underline">
            Kebijakan Privasi
          </Link>{" "}
          dan{" "}
          <Link href="/data-deletion" className="font-medium text-brand hover:underline">
            Penghapusan Data
          </Link>
          .
        </p>
        <PendingDecision>
          Kanal kontak resmi, hukum yang berlaku, dan forum penyelesaian sengketa. Tidak ada yang ditetapkan dalam
          draf ini.
        </PendingDecision>
      </LegalSection>
    </LegalDocument>
  );
}
