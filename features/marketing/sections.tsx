import Link from "next/link";
import {
  Upload,
  Brain,
  Target,
  Radio,
  Wallet,
  Sparkles,
  Eye,
  Rocket,
  BarChart3,
  Package,
  FileText,
  TrendingUp,
  Search,
  ShieldCheck,
  Bot,
  Globe,
  Lock,
  KeyRound,
  ScrollText,
  Building2,
  Store,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function Hero() {
  return (
    <section className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-6 pb-20 pt-24 text-center">
      <Badge variant="brand">Tanyopo Labs</Badge>
      <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
        Tim Marketing AI untuk Bisnis Anda
      </h1>
      <p className="max-w-2xl text-lg text-muted-foreground">
        Dari produk hingga campaign, konten, analisis, dan optimasi — dalam satu platform.
        Anda tetap yang memegang kendali atas akun, izin, budget, dan publikasi.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button asChild size="lg">
          <Link href="/register">Mulai Promosi dengan AI</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <a href="#cara-kerja">Lihat Cara Kerjanya</a>
        </Button>
      </div>
    </section>
  );
}

const STEPS = [
  { icon: Upload, title: "Upload Produk", desc: "Unggah produk, jasa, atau aplikasi Anda." },
  { icon: Brain, title: "AI Memahami Produk", desc: "AI menyusun marketing blueprint dari data produk." },
  { icon: Target, title: "Pilih Tujuan", desc: "Tambah penjualan, leads, followers, atau trafik." },
  { icon: Radio, title: "Pilih Channel", desc: "Facebook, Instagram, TikTok, X, atau SEO." },
  { icon: Wallet, title: "Atur Budget", desc: "Tentukan berapa uang maksimal yang boleh digunakan." },
  { icon: Sparkles, title: "AI Buat Strategi & Konten", desc: "Positioning, copy, creative, hingga alokasi budget." },
  { icon: Eye, title: "Preview & Persetujuan", desc: "Anda tinjau, edit, atau regenerasi sebelum tayang." },
  { icon: Rocket, title: "Publish", desc: "Campaign berjalan setelah lolos budget & policy check." },
  { icon: BarChart3, title: "Analytics & Optimasi", desc: "AI memantau performa dan menyarankan perbaikan." },
];

export function HowItWorks() {
  return (
    <section id="cara-kerja" className="border-t border-border bg-surface-muted/40 py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-12 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            Cara Kerjanya
          </h2>
          <p className="mt-2 text-muted-foreground">
            Alur sederhana dari produk sampai hasil yang terukur.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((step, i) => (
            <Card key={step.title}>
              <CardContent className="flex flex-col gap-3 p-5">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-[var(--radius-md)] bg-brand-muted">
                    <step.icon className="size-4 text-brand" aria-hidden />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">
                    Langkah {i + 1}
                  </span>
                </div>
                <p className="text-sm font-semibold text-foreground">{step.title}</p>
                <p className="text-sm text-muted-foreground">{step.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

const CAPABILITIES = [
  { icon: Package, title: "Marketing Blueprint", desc: "AI menyusun positioning, USP, dan target audiens dari data produk Anda." },
  { icon: FileText, title: "Content Studio", desc: "Caption, hook, script, hingga hashtag — siap untuk setiap platform." },
  { icon: Rocket, title: "Promote Wizard", desc: "Dari tujuan sampai campaign siap tayang dalam satu alur terpandu." },
  { icon: TrendingUp, title: "Growth", desc: "Roadmap pertumbuhan follower berbasis konten dan strategi, tanpa bot." },
  { icon: Search, title: "SEO", desc: "Rekomendasi keyword, on-page, dan content plan untuk website Anda." },
  { icon: ShieldCheck, title: "Approval & Budget Guard", desc: "Setiap aksi berbayar melewati pengecekan budget dan persetujuan." },
  { icon: Bot, title: "Autopilot Bertingkat", desc: "Manual, AI Assist, atau Autopilot — selalu dengan emergency stop." },
  { icon: BarChart3, title: "Analytics Nyata", desc: "Metrik dari data sungguhan, ditandai jelas bila masih data demo." },
];

export function Capabilities() {
  return (
    <section id="kapabilitas" className="py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-12 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">Kapabilitas</h2>
          <p className="mt-2 text-muted-foreground">
            Satu platform untuk seluruh siklus marketing bisnis Anda.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CAPABILITIES.map((c) => (
            <Card key={c.title}>
              <CardContent className="flex flex-col gap-3 p-5">
                <c.icon className="size-5 text-brand" aria-hidden />
                <p className="text-sm font-semibold text-foreground">{c.title}</p>
                <p className="text-sm text-muted-foreground">{c.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

const CHANNELS = ["Facebook", "Instagram", "TikTok", "X", "SEO / Website"];

export function Channels() {
  return (
    <section className="border-t border-border bg-surface-muted/40 py-20">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Channel yang Didukung
        </h2>
        <p className="mt-2 text-muted-foreground">
          Channel yang belum Anda hubungkan akan ditandai jelas — tidak pernah berpura-pura
          aktif.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-8">
          {CHANNELS.map((label) => (
            <div key={label} className="flex flex-col items-center gap-2">
              <div className="flex size-12 items-center justify-center rounded-full border border-border bg-surface text-sm font-semibold text-foreground">
                {label.slice(0, 1)}
              </div>
              <span className="text-sm text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Audiences() {
  return (
    <section className="py-20">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-6 sm:grid-cols-2">
        <Card>
          <CardContent className="flex flex-col gap-3 p-8">
            <Store className="size-6 text-brand" aria-hidden />
            <h3 className="text-lg font-semibold text-foreground">Untuk UMKM</h3>
            <p className="text-sm text-muted-foreground">
              Anda tidak perlu jadi ahli iklan. Tanyopo AI Promoter menerjemahkan istilah
              marketing yang rumit menjadi bahasa sederhana — dan bisa langsung terhubung
              dengan produk yang sudah Anda kelola di UMKMpro AI.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-3 p-8">
            <Building2 className="size-6 text-brand" aria-hidden />
            <h3 className="text-lg font-semibold text-foreground">Untuk Brand</h3>
            <p className="text-sm text-muted-foreground">
              Kelola banyak produk dan campaign lintas channel dengan approval workflow,
              budget guard, dan jejak audit yang rapi untuk tim Anda.
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

export function UmkmproIntegration() {
  return (
    <section className="border-t border-border bg-surface-muted/40 py-20">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Satu Ekosistem, Dua Produk
        </h2>
        <p className="mt-3 text-muted-foreground">
          <strong className="text-foreground">UMKMpro AI</strong> mengelola bisnis Anda —{" "}
          <strong className="text-foreground">Tanyopo AI Promoter</strong> menumbuhkannya.
          Pengguna UMKMpro AI dapat mengirim produk ke Promoter dengan satu klik; Promoter
          tetap berjalan penuh untuk pengguna yang tidak memakai UMKMpro AI sama sekali.
        </p>
      </div>
    </section>
  );
}

const SECURITY_POINTS = [
  { icon: Lock, title: "Row Level Security", desc: "Setiap data tenant terisolasi di level database, bukan hanya di aplikasi." },
  { icon: KeyRound, title: "Tidak Menyimpan Password Sosial", desc: "Koneksi ke Facebook, Instagram, TikTok, dan X memakai OAuth resmi — bukan password Anda." },
  { icon: ScrollText, title: "Jejak Audit", desc: "Aksi penting seperti koneksi akun, peluncuran campaign, dan perubahan budget tercatat." },
];

export function Security() {
  return (
    <section id="keamanan" className="py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-12 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">Keamanan</h2>
          <p className="mt-2 text-muted-foreground">
            Dibangun dengan prinsip multi-tenant yang ketat sejak hari pertama.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {SECURITY_POINTS.map((p) => (
            <div key={p.title} className="flex flex-col items-center gap-3 text-center">
              <div className="flex size-11 items-center justify-center rounded-full bg-brand-muted">
                <p.icon className="size-5 text-brand" aria-hidden />
              </div>
              <p className="text-sm font-semibold text-foreground">{p.title}</p>
              <p className="text-sm text-muted-foreground">{p.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const PLANS = ["Free", "Pro", "Business", "Growth", "Agency", "Bundle UMKMpro"];

export function PricingTeaser() {
  return (
    <section id="harga" className="border-t border-border bg-surface-muted/40 py-20">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Harga</h2>
        <p className="mt-2 text-muted-foreground">
          Beberapa paket sedang kami siapkan — detail harga akan diumumkan sebelum peluncuran
          publik.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {PLANS.map((p) => (
            <Badge key={p} variant="outline">
              {p}
            </Badge>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className="py-20">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-6 text-center">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Siap menumbuhkan bisnis Anda dengan AI?
        </h2>
        <Button asChild size="lg">
          <Link href="/register">Mulai Promosi dengan AI</Link>
        </Button>
      </div>
    </section>
  );
}
