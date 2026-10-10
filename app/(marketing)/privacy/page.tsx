import Link from "next/link";
import { LegalDocument, LegalList, LegalSection, PendingDecision } from "@/features/legal/legal-parts";
import { LEGAL, legalMetadata } from "@/features/legal/legal-meta";

export const metadata = legalMetadata({
  title: "Kebijakan Privasi",
  description:
    "Cara LINOE by Tanyopo mengumpulkan, menggunakan, menyimpan, dan melindungi data pribadi serta data bisnis Anda, dan hak yang Anda miliki.",
  path: "/privacy",
});

const TOC = [
  { id: "pengendali", title: "Siapa kami" },
  { id: "data", title: "Data yang kami proses" },
  { id: "tujuan", title: "Tujuan dan dasar pemrosesan" },
  { id: "pihak-ketiga", title: "Pihak ketiga dan integrasi" },
  { id: "penyimpanan", title: "Penyimpanan, keamanan, dan retensi" },
  { id: "hak", title: "Hak Anda" },
  { id: "permintaan", title: "Mengajukan permintaan privasi" },
  { id: "perubahan", title: "Perubahan kebijakan" },
];

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Kebijakan Privasi"
      intro="Halaman ini menjelaskan data apa yang diproses LINOE, untuk apa, dengan siapa data itu dibagikan, dan bagaimana Anda dapat mengendalikannya. Kami menulisnya sesuai cara aplikasi bekerja saat ini."
      toc={TOC}
      current="/privacy"
    >
      <LegalSection id="pengendali" title="1. Siapa kami">
        <p>
          {LEGAL.product} dioperasikan oleh <strong>{LEGAL.operator}</strong>, berlokasi di {LEGAL.location} (“kami”).
          Kami menentukan tujuan dan cara pemrosesan data akun dan data bisnis yang Anda masukkan ke LINOE.
        </p>
        <PendingDecision>
          Alamat surel (atau kanal resmi lain) untuk pertanyaan privasi, serta nama penanggung jawab pelindungan data
          jika ditunjuk. Sampai ditetapkan, jangan menganggap halaman ini menyebut kanal kontak tertentu.
        </PendingDecision>
      </LegalSection>

      <LegalSection id="data" title="2. Data yang kami proses">
        <p>Berdasarkan fitur yang ada saat ini, kami memproses kategori data berikut:</p>
        <LegalList
          items={[
            <>
              <strong>Data akun:</strong> nama, nama bisnis, alamat email, dan kata sandi. Kata sandi dikelola oleh
              layanan autentikasi pihak ketiga kami (lihat bagian 4) dan tidak kami simpan dalam bentuk teks biasa.
            </>,
            <>
              <strong>Data bisnis yang Anda masukkan:</strong> profil bisnis dan brand, data produk (nama, deskripsi,
              harga, kategori), serta foto atau media produk yang Anda unggah.
            </>,
            <>
              <strong>Konten dan hasil kerja:</strong> strategi, naskah, konten, dan rencana campaign yang Anda buat
              atau dihasilkan AI untuk Anda, termasuk catatan persetujuan dan status campaign.
            </>,
            <>
              <strong>Catatan penggunaan AI:</strong> jenis permintaan AI, referensi masukan, penyedia dan model yang
              dipakai, jumlah token, status, serta hasil keluaran. Catatan ini juga dipakai untuk menghitung kuota
              paket Anda.
            </>,
            <>
              <strong>Data langganan:</strong> paket, status uji coba atau langganan, dan masa berlaku.
            </>,
            <>
              <strong>Integrasi platform iklan:</strong> bila Anda menghubungkan Meta, TikTok, atau X: nama dan ID akun
              yang terhubung, status koneksi, masa berlaku token, serta token akses yang disimpan terenkripsi.
            </>,
            <>
              <strong>Catatan aktivitas (audit log):</strong> riwayat tindakan penting di akun, misalnya persetujuan atau
              perubahan campaign.
            </>,
            <>
              <strong>Data teknis:</strong> alamat IP perangkat Anda dibaca saat pendaftaran untuk membatasi
              pendaftaran massal; pembatas ini bekerja di memori server dan tidak kami simpan ke basis data kami.
              Penyedia hosting dan autentikasi dapat mencatat data teknis pada log mereka sendiri.
            </>,
          ]}
        />
        <p>
          Kami tidak memasang pelacak iklan atau alat analitik pihak ketiga pada aplikasi ini. Kami menggunakan cookie
          yang diperlukan agar layanan berfungsi: cookie sesi masuk, cookie sementara untuk keamanan proses
          menghubungkan akun platform iklan, dan cookie sesi untuk lingkungan demo.
        </p>
      </LegalSection>

      <LegalSection id="tujuan" title="3. Tujuan dan dasar pemrosesan">
        <LegalList
          items={[
            "Membuat dan mengamankan akun Anda serta menyediakan layanan yang Anda minta (pelaksanaan perjanjian).",
            "Membuat strategi, konten, dan rencana campaign dengan bantuan AI atas permintaan Anda.",
            "Menerapkan batas paket dan masa uji coba, serta mencegah penyalahgunaan layanan (kepentingan sah kami dalam menjaga layanan tetap aman dan adil).",
            "Menghubungkan akun platform iklan dan menjalankan tindakan yang Anda setujui (berdasarkan persetujuan Anda saat menghubungkan akun).",
            "Menjaga keamanan, mencatat audit, dan memenuhi kewajiban hukum yang berlaku.",
          ]}
        />
        <p>
          Kami tidak menjual data pribadi Anda. Saat ini aplikasi tidak meminta Anda mencentang persetujuan terpisah
          saat mendaftar; kami akan memberi tahu dan meminta persetujuan yang sesuai bila ada pemrosesan yang
          memerlukannya.
        </p>
        <PendingDecision>
          Konfirmasi hukum atas dasar pemrosesan untuk setiap tujuan di atas oleh penasihat hukum, termasuk apakah
          diperlukan mekanisme persetujuan eksplisit saat pendaftaran.
        </PendingDecision>
      </LegalSection>

      <LegalSection id="pihak-ketiga" title="4. Pihak ketiga dan integrasi">
        <p>Untuk menjalankan layanan, data diproses oleh penyedia berikut sesuai fungsinya:</p>
        <LegalList
          items={[
            <>
              <strong>Supabase</strong> — basis data, autentikasi, dan penyimpanan file. Berkas media produk disimpan di
              penyimpanan yang dapat dibuka lewat tautan publik; jangan mengunggah berkas yang bersifat rahasia.
            </>,
            <>
              <strong>Netlify</strong> — hosting aplikasi.
            </>,
            <>
              <strong>OpenAI dan Anthropic</strong> — penyedia model AI. Untuk menghasilkan konten, teks permintaan yang
              memuat data produk dan bisnis Anda dikirim ke penyedia yang dipilih sistem. Anda sebaiknya tidak
              memasukkan data pribadi pelanggan Anda ke kolom yang diproses AI.
            </>,
            <>
              <strong>Meta, TikTok, dan X</strong> — hanya bila Anda sendiri menghubungkan akun. Kami meminta izin
              (scope) yang berkaitan dengan membaca dan mengelola iklan; untuk Meta juga daftar Page. Anda dapat
              memutuskan koneksi kapan saja dari menu Koneksi. Kemampuan peluncuran iklan eksternal saat ini dibatasi
              dan tidak aktif secara default.
            </>,
            <>
              <strong>Penyedia pembayaran</strong> — integrasi pembayaran (Xendit) disiapkan, tetapi belum diaktifkan
              untuk pembayaran sungguhan pada saat draf ini ditulis. Data kartu atau rekening tidak diproses oleh kami
              secara langsung.
            </>,
            <>
              <strong>UMKMpro AI</strong> — bila Anda memakai integrasi dengan UMKMpro, data yang diperlukan untuk
              integrasi itu dipertukarkan melalui antarmuka terotorisasi.
            </>,
          ]}
        />
        <p>
          Setiap platform pihak ketiga memiliki kebijakan privasi sendiri yang berlaku atas data yang mereka proses.
        </p>
        <PendingDecision>
          Lokasi server (wilayah) Supabase dan penyedia lain, penyedia pengiriman email transaksional, serta dasar
          hukum transfer data lintas negara. Daftar ini belum diverifikasi sebagai daftar akhir penyedia.
        </PendingDecision>
      </LegalSection>

      <LegalSection id="penyimpanan" title="5. Penyimpanan, keamanan, dan retensi">
        <p>Langkah keamanan yang diterapkan aplikasi saat ini antara lain:</p>
        <LegalList
          items={[
            "Data setiap bisnis dipisahkan per akun (tenant) dengan aturan akses di tingkat basis data.",
            "Token akses platform iklan disimpan terenkripsi dan hanya dapat dibaca oleh proses server.",
            "Pembatasan jumlah percobaan pendaftaran dan pembatasan penggunaan AI untuk mencegah penyalahgunaan.",
            "Komunikasi dengan aplikasi menggunakan koneksi terenkripsi (HTTPS).",
          ]}
        />
        <p>
          Tidak ada sistem yang sepenuhnya bebas risiko. Kami tidak mengklaim sertifikasi keamanan tertentu dan tidak
          dapat menjamin keamanan mutlak.
        </p>
        <PendingDecision>
          Jangka waktu penyimpanan data (akun aktif, akun tidak aktif, setelah permintaan penghapusan, serta cadangan).
          Kami tidak menetapkan angka retensi dalam draf ini. Status cadangan basis data juga belum diverifikasi.
        </PendingDecision>
      </LegalSection>

      <LegalSection id="hak" title="6. Hak Anda">
        <p>Sesuai peraturan pelindungan data pribadi yang berlaku di Indonesia, Anda dapat meminta untuk:</p>
        <LegalList
          items={[
            "mengetahui dan mengakses data pribadi Anda yang kami proses;",
            "memperbaiki data yang tidak akurat atau tidak lengkap;",
            "menghapus data pribadi Anda atau mengakhiri pemrosesannya, sepanjang tidak ada kewajiban hukum untuk menyimpannya;",
            "menarik persetujuan yang pernah Anda berikan, termasuk memutuskan koneksi akun platform iklan;",
            "mengajukan keberatan atau pertanyaan atas pemrosesan data Anda.",
          ]}
        />
        <p>
          Sebagian dapat Anda lakukan sendiri di aplikasi (misalnya mengubah data produk, menghapus media produk, dan
          memutuskan koneksi platform). Untuk penghapusan akun dan data, lihat{" "}
          <Link href="/data-deletion" className="font-medium text-brand hover:underline">
            halaman Penghapusan Data
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection id="permintaan" title="7. Mengajukan permintaan privasi">
        <p>
          Anda dapat mengajukan permintaan akses, perbaikan, atau penghapusan data. Kami akan memverifikasi bahwa
          permintaan berasal dari pemilik akun sebelum memprosesnya.
        </p>
        <PendingDecision>
          Kanal pengajuan resmi (alamat email atau formulir) dan target waktu tanggapan. Kami tidak mencantumkan
          alamat kontak atau batas waktu sebelum ditetapkan perusahaan.
        </PendingDecision>
      </LegalSection>

      <LegalSection id="perubahan" title="8. Perubahan kebijakan">
        <p>
          Kebijakan ini dapat diperbarui seiring perubahan layanan atau ketentuan hukum. Versi yang berlaku adalah
          versi yang ditampilkan di halaman ini. Untuk perubahan yang berdampak material, kami akan memberi tahu Anda
          melalui aplikasi atau email.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
