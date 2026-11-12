import Link from "next/link";
import { LEGAL_LINKS } from "./legal-meta";

/** Link row to the three public legal pages. Informational only: no consent state. */
export function LegalLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="Informasi hukum" className={className}>
      <ul className="flex flex-wrap gap-x-5">
        {LEGAL_LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="inline-flex min-h-11 items-center hover:text-foreground hover:underline">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
