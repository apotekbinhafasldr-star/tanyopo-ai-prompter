import type { Metadata } from "next";
import { LinoeLogo } from "@/components/brand/linoe-logo";

// Authentication pages (login, register, forgot/reset password, session error) are not search landing pages.
// `noindex` is read by crawlers only if they may fetch the page, so these paths are intentionally NOT disallowed
// in robots.txt. Each page keeps its own title (metadata merges).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-4 py-12">
      <LinoeLogo />
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
