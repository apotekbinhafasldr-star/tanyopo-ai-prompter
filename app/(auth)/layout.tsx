import { LinoeLogo } from "@/components/brand/linoe-logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-4 py-12">
      <LinoeLogo />
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
