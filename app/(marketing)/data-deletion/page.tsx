import Link from "next/link";
import { LegalDocument, LegalList, LegalSection, PendingDecision } from "@/features/legal/legal-parts";
import { legalMetadata } from "@/features/legal/legal-meta";

export const metadata = legalMetadata({
  title: "Penghapusan Data Pengguna",
  description:
    "Cara meminta penghapusan akun dan data di LINOE by Tanyopo, proses verifikasi kepemilikan, data yang dapat dihapus, dan data yang wajib dipertahankan.",
  path: "/data-deletion",
});

const TOC = [
  { id: "cara", title: "Cara mengajukan permintaan" },
  { id: "verifikasi", title: "Verifikasi kepemilikan" },
  { id: "dapat-dihapus", title: "Data yang dapat dihapus" },
  { id: "dipertahankan", title: "Data yang dapat dipertahankan" },
  { id: "integrasi", title: "Data integrasi platform" },
  { id: "sendiri", title: "Yang dapat Anda lakukan sendiri" },
];

export default function DataDeletionPage() {
  return (
    <LegalDocument
      title="Penghapusan Data Pengguna"
      intro="Anda dapat meminta penghapusan akun LINOE beserta data yang terkait. Halaman ini menjelaskan alurnya dan apa yang terjadi pada data Anda, termasuk data dari platform iklan yang pernah Anda hubungkan."
      toc={TOC}
      current="/data-deletion"
    >
      <LegalSection id="cara" title="1. Cara mengajukan permintaan">
        <p>
          Saat ini penghapusan akun dan data diproses secara manual oleh tim kami setelah Anda mengajukan permintaan.
          Aplikasi belum menyediakan tombol hapus akun otomatis.
        </p>
        <PendingDecision>
          Kanal pengajuan resmi (alamat email atau formulir) dan target waktu penyelesaian. Tidak ada alamat kontak
          atau batas waktu (SLA) yang dicantumkan sebelum ditetapkan perusahaan.
        </PendingDecision>
      </LegalSection>

      <LegalSection id="verifikasi" title="2. Verifikasi kepemilikan">
        <p>
          Untuk melindungi akun Anda, kami hanya memproses permintaan yang dapat dipastikan berasal dari pemilik akun.
          Kami akan meminta Anda mengajukan permintaan dari alamat email yang terdaftar pada akun, dan dapat meminta
          informasi tambahan yang wajar untuk memastikan identitas. Kami tidak akan meminta kata sandi Anda.
        </p>
        <PendingDecision>Langkah verifikasi rinci yang akan dijalankan tim (misalnya tautan konfirmasi ke email terdaftar).</PendingDecision>
      </LegalSection>

      <LegalSection id="dapat-dihapus" title="3. Data yang dapat dihapus">
        <p>Atas permintaan yang terverifikasi, data berikut termasuk yang dapat dihapus:</p>
        <LegalList
          items={[
            "data akun (nama, nama bisnis, email) dan akses masuk;",
            "profil bisnis dan brand, produk, serta media produk yang diunggah;",
            "strategi, konten, campaign, dan riwayat penggunaan AI yang terkait akun;",
            "koneksi platform iklan beserta token akses yang tersimpan.",
          ]}
        />
        <PendingDecision>
          Daftar akhir data yang dihapus versus dianonimkan, dan perlakuan atas cadangan basis data.
        </PendingDecision>
      </LegalSection>

      <LegalSection id="dipertahankan" title="4. Data yang dapat dipertahankan">
        <p>
          Sebagian data dapat tetap kami simpan sejauh diwajibkan oleh hukum atau diperlukan untuk kepentingan sah,
          misalnya catatan transaksi dan penagihan untuk kewajiban perpajakan atau pembukuan, serta catatan yang
          diperlukan untuk mencegah penyalahgunaan (misalnya pembuatan akun uji coba berulang) dan menyelesaikan
          sengketa.
        </p>
        <PendingDecision>Jenis dan lama penyimpanan data yang dipertahankan. Tidak ada jangka waktu yang dinyatakan di draf ini.</PendingDecision>
      </LegalSection>

      <LegalSection id="integrasi" title="5. Data integrasi platform (Meta, TikTok, X)">
        <LegalList
          items={[
            "Memutuskan koneksi dari menu Koneksi menghentikan akses LINOE ke akun platform tersebut.",
            "Token akses platform yang kami simpan termasuk data yang dapat dihapus atas permintaan Anda (lihat bagian 3).",
            "Data yang sudah berada di platform tersebut (misalnya iklan, Page, atau akun iklan) tidak kami kendalikan. Hapus atau cabut akses dari pengaturan akun Meta, TikTok, atau X Anda; platform memiliki kebijakan sendiri.",
          ]}
        />
      </LegalSection>

      <LegalSection id="sendiri" title="6. Yang dapat Anda lakukan sendiri">
        <LegalList
          items={[
            "Memutuskan koneksi platform iklan dari menu Koneksi.",
            "Menghapus media produk yang Anda unggah.",
            "Mengarsipkan produk yang tidak lagi dipakai.",
          ]}
        />
        <p>
          Informasi lebih lengkap tentang data yang kami proses ada di{" "}
          <Link href="/privacy" className="font-medium text-brand hover:underline">
            Kebijakan Privasi
          </Link>
          .
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
