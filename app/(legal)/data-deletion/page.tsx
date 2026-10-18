import Link from "next/link";
import { LegalDocument, LegalList, LegalSection } from "@/features/legal/legal-parts";
import { LEGAL, legalMetadata } from "@/features/legal/legal-meta";

export const metadata = legalMetadata({
  title: "Penghapusan Data Pengguna",
  description:
    "Cara meminta penghapusan data Anda dari LINOE by Tanyopo, tahapan penanganan permintaan, perbedaan data LINOE dengan akun login bersama, dan batasannya.",
  path: "/data-deletion",
});

const TOC = [
  { id: "mandiri", title: "Yang dapat Anda lakukan sendiri" },
  { id: "penerimaan", title: "Tahap 1: Penerimaan permintaan" },
  { id: "verifikasi", title: "Tahap 2: Verifikasi identitas" },
  { id: "penilaian", title: "Tahap 3: Penilaian lingkup dan kewajiban hukum" },
  { id: "pelaksanaan", title: "Tahap 4: Pelaksanaan" },
  { id: "hasil", title: "Tahap 5: Pemberitahuan hasil" },
  { id: "batasan", title: "Batasan" },
  { id: "kontak", title: "Kontak" },
];

export default function DataDeletionPage() {
  return (
    <LegalDocument
      title="Penghapusan Data Pengguna"
      intro="Halaman ini menjelaskan cara meminta penghapusan data Anda dari LINOE dan bagaimana permintaan ditangani. LINOE belum menyediakan tombol hapus akun otomatis. Permintaan ditangani oleh tim kami secara manual dan bertahap."
      toc={TOC}
      current="/data-deletion"
    >
      <LegalSection id="mandiri" title="Yang dapat Anda lakukan sendiri (Owner)">
        <LegalList
          items={[
            <>
              Memutus koneksi Meta, TikTok, atau X dari halaman Koneksi. Ini menghapus koneksi dan token dari sistem
              kami dan mencoba mencabut akses di platform. Data kinerja yang sudah diimpor tidak ikut terhapus. Cabut
              juga izin aplikasi dari pengaturan platform Anda (untuk Meta: pengaturan “Aplikasi dan Situs Web” di akun
              Facebook).
            </>,
            <>Menghapus berkas media produk dari halaman produk.</>,
          ]}
        />
      </LegalSection>

      <LegalSection id="penerimaan" title="Tahap 1: Penerimaan permintaan">
        <p>
          Kirim email ke <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a> dengan subjek “Permintaan
          Penghapusan Data LINOE”, berisi email akun Anda dan data yang ingin dihapus. Kami akan membalas setelah
          permintaan diterima. Halaman ini tidak menetapkan jangka waktu balasan atau penyelesaian.
        </p>
      </LegalSection>

      <LegalSection id="verifikasi" title="Tahap 2: Verifikasi identitas">
        <p>
          Sebelum memproses, kami memverifikasi bahwa Anda adalah pemilik akun, misalnya dengan meminta Anda membalas
          dari email akun terdaftar. Untuk data workspace, kami memverifikasi kepemilikan workspace. Kami tidak pernah
          meminta kata sandi.
        </p>
      </LegalSection>

      <LegalSection id="penilaian" title="Tahap 3: Penilaian lingkup dan kewajiban hukum">
        <p>
          Kami menilai data mana yang menjadi lingkup permintaan dan apakah ada alasan teknis atau hukum untuk
          mempertahankan sebagian. Kategori yang kami nilai:
        </p>
        <LegalList
          items={[
            <>
              <strong>Dapat dihapus:</strong> data LINOE di workspace Anda, yaitu produk, media, kampanye, konten,
              SEO, analitik, pengaturan, dan koneksi platform beserta tokennya. Penghapusan dilakukan per data LINOE
              dan tidak menghapus workspace atau data produk Tanyopo lain (misalnya UMKMpro AI) yang memakai akun yang
              sama.
            </>,
            <>
              <strong>Dapat dihapus atau dianonimkan secara manual bila memungkinkan:</strong> pengenal pribadi pada
              catatan aktivitas dan catatan pemakaian AI. Kami belum memiliki alat anonimisasi otomatis, dan kolom teks
              bebas (misalnya konteks catatan aktivitas atau masukan AI) perlu ditinjau satu per satu sehingga tidak
              semuanya dapat dijamin dapat dianonimkan.
            </>,
            <>
              <strong>Dapat dipertahankan:</strong> catatan transaksi, invoice, dan penagihan bila ada, catatan
              keamanan, serta catatan yang diperlukan untuk kewajiban hukum, keuangan, atau keamanan yang sah. Alasannya kami jelaskan dalam jawaban atas permintaan Anda.
            </>,
            <>
              <strong>Akun login bersama:</strong> akun login (email dan profil dasar) dipakai bersama oleh produk
              Tanyopo lainnya. Permintaan ini tidak otomatis menghapusnya. Penghapusan akun login memengaruhi produk
              lain yang Anda gunakan, sehingga dinilai sebagai permintaan terpisah dan tidak dijanjikan otomatis.
            </>,
          ]}
        />
        <p>
          <strong>Permintaan dari non-Owner:</strong> anggota workspace yang bukan Owner dapat meminta data pribadinya
          sendiri (misalnya jejak aktivitas atas nama mereka) dihapus atau dianonimkan. Data bisnis workspace hanya
          dihapus atas permintaan Owner.
        </p>
      </LegalSection>

      <LegalSection id="pelaksanaan" title="Tahap 4: Pelaksanaan">
        <p>
          Penghapusan dijalankan secara manual dan terkontrol, hanya setelah verifikasi dan penilaian selesai.
          Prosedur ini baru dan belum otomatis, sehingga kami akan menyampaikan tahapan yang sudah dan belum dapat
          dilakukan. Halaman ini tidak menetapkan waktu penyelesaian.
        </p>
      </LegalSection>

      <LegalSection id="hasil" title="Tahap 5: Pemberitahuan hasil">
        <p>
          Setelah tindakan benar-benar dilakukan, kami mengirim pemberitahuan tertulis yang menjelaskan apa yang
          dihapus, dianonimkan, dan dipertahankan, beserta batasannya. Jika kami menolak sebagian permintaan, kami
          menyertakan alasannya. Hak Anda dan tenggat penanganannya tetap tunduk pada hukum yang berlaku di Indonesia.
        </p>
      </LegalSection>

      <LegalSection id="batasan" title="Batasan">
        <LegalList
          items={[
            <>
              Bila kami membuat cadangan, cadangan itu dapat masih memuat data yang sudah dihapus sampai diganti.
            </>,
            <>
              Pihak ketiga (penyedia AI, hosting, email, dan platform iklan) menyimpan data menurut kebijakan mereka.
              Kami tidak dapat menjamin penghapusan dari sistem mereka.
            </>,
            <>Berkas publik dapat masih tersaji dari cache untuk waktu singkat.</>,
          ]}
        />
      </LegalSection>

      <LegalSection id="kontak" title="Kontak">
        <p>
          {LEGAL.operator}, <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>. Lihat juga{" "}
          <Link href="/privacy" className="font-medium text-brand hover:underline">
            Kebijakan Privasi
          </Link>
          .
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
