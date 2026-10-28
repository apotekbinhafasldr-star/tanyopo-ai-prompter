import LegalLayout from "@/app/(legal)/layout";

/**
 * The Help Center reuses the legal route group's in-flow header and footer
 * (the landing page's fixed hero header would overlap page content). No
 * layout logic is duplicated: the shell is the legal layout itself.
 */
export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return <LegalLayout>{children}</LegalLayout>;
}
