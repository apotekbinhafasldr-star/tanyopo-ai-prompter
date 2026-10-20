import { Mail, MapPin, Phone } from "lucide-react";
import { LEGAL } from "./legal-meta";

/**
 * Official operator identity + contact block for public footers (landing,
 * legal pages). Values come only from LEGAL (Founder-supplied facts), so the
 * landing, footer and legal pages can never drift apart. `<address>` is the
 * semantic element for contact information of the page owner.
 */
export function CompanyContact({ className }: { className?: string }) {
  return (
    <address
      aria-label={`Kontak ${LEGAL.operator}`}
      className={`flex flex-col gap-1.5 text-sm not-italic text-muted-foreground ${className ?? ""}`}
    >
      <p className="font-medium text-foreground">{LEGAL.operator}</p>
      <p className="flex items-start gap-2">
        <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{LEGAL.location}</span>
      </p>
      <p className="flex items-center gap-2">
        <Phone className="size-4 shrink-0" aria-hidden />
        <a href={`tel:${LEGAL.contactPhoneHref}`} className="hover:text-foreground hover:underline">
          {LEGAL.contactPhone}
        </a>
      </p>
      <p className="flex items-center gap-2">
        <Mail className="size-4 shrink-0" aria-hidden />
        <a href={`mailto:${LEGAL.contactEmail}`} className="break-all hover:text-foreground hover:underline">
          {LEGAL.contactEmail}
        </a>
      </p>
    </address>
  );
}
