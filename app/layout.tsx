import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Absolute base for canonical / Open Graph URLs. Read from the public app
 * URL env var; if it is missing or not a valid URL, no base is set (Next.js
 * then keeps its default behaviour) rather than guessing a domain.
 */
function resolveMetadataBase(): URL | undefined {
  const raw = process.env.NEXT_PUBLIC_APP_URL;
  if (!raw) return undefined;
  try {
    return new URL(raw);
  } catch {
    return undefined;
  }
}

export const metadata: Metadata = {
  metadataBase: resolveMetadataBase(),
  title: {
    default: "LINOE — AI Marketing & Growth Platform by Tanyopo",
    template: "%s",
  },
  description:
    "LINOE membantu Anda menganalisis produk, menyusun strategi, membuat konten, menyiapkan campaign, memantau hasil, dan mengoptimasi pertumbuhan — semua dengan AI dalam satu platform.",
  openGraph: {
    title: "LINOE — AI Marketing & Growth Platform by Tanyopo",
    description:
      "LINOE membantu Anda menganalisis produk, menyusun strategi, membuat konten, menyiapkan campaign, memantau hasil, dan mengoptimasi pertumbuhan — semua dengan AI dalam satu platform.",
    siteName: "LINOE",
    locale: "id_ID",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "LINOE — AI Marketing & Growth Platform by Tanyopo",
    description:
      "LINOE membantu Anda menganalisis produk, menyusun strategi, membuat konten, menyiapkan campaign, memantau hasil, dan mengoptimasi pertumbuhan — semua dengan AI dalam satu platform.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
