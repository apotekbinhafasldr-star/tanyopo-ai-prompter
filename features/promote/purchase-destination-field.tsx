"use client";

import { useEffect, useState } from "react";
import { Globe, MessageCircle, CircleSlash } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils/cn";
import {
  buildPurchaseDestination,
  DESTINATION_LABELS,
  type DestinationType,
} from "@/lib/campaigns/purchase-destination";

const OPTIONS: { type: DestinationType; icon: typeof Globe; hint: string }[] = [
  { type: "WEBSITE", icon: Globe, hint: "Calon pembeli membuka website / toko online Anda." },
  { type: "WHATSAPP", icon: MessageCircle, hint: "Calon pembeli langsung chat WhatsApp Anda." },
  {
    type: "NONE",
    icon: CircleSlash,
    hint: "AI tetap membuat strategi, tetapi iklan berbayar tidak bisa diluncurkan sampai ada tujuan.",
  },
];

/**
 * Purchase destination picker shared by the quick and the full Promote wizard ("Calon pembeli
 * diarahkan ke mana?"). Pure UI: validation reuses lib/campaigns/purchase-destination (the server
 * re-validates and is the source of truth). Emits hidden inputs destinationType/destinationValue.
 * Prefill values come from the product / brand profile but are only suggestions: editing here
 * never writes back to the catalog or brand.
 */
export function PurchaseDestinationField({
  websiteDefault,
  whatsappDefault,
  onValidityChange,
  onChange,
  initialType,
  initialValue,
}: {
  websiteDefault?: string | null;
  whatsappDefault?: string | null;
  onValidityChange: (valid: boolean) => void;
  /** Reports the current choice so a parent can show it in a summary. */
  onChange?: (type: DestinationType | "", value: string) => void;
  /** Edit mode: start from the campaign's stored destination. */
  initialType?: DestinationType | "";
  initialValue?: string;
}) {
  const [type, setType] = useState<DestinationType | "">(initialType ?? "");
  const [website, setWebsite] = useState(initialType === "WEBSITE" ? (initialValue ?? "") : (websiteDefault ?? ""));
  const [whatsapp, setWhatsapp] = useState(
    initialType === "WHATSAPP" ? (initialValue ?? "") : (whatsappDefault ?? ""),
  );

  // A fresh (re)mount reports its real state so the parent's validity can never go stale.
  useEffect(() => {
    const v = initialType === "WEBSITE" || initialType === "WHATSAPP" ? (initialValue ?? "") : "";
    onValidityChange(initialType ? buildPurchaseDestination({ type: initialType, value: v }, null).ok : false);
    onChange?.(initialType ?? "", v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = type === "WEBSITE" ? website : type === "WHATSAPP" ? whatsapp : "";
  // ownHosts unknown on the client (null): the server re-checks with the strict own-host list.
  const result = type ? buildPurchaseDestination({ type, value }, null) : null;
  const error = result && !result.ok && value.trim().length > 0 ? result.message : null;

  function report(nextType: DestinationType | "", nextWebsite: string, nextWhatsapp: string) {
    const v = nextType === "WEBSITE" ? nextWebsite : nextType === "WHATSAPP" ? nextWhatsapp : "";
    onChange?.(nextType, v);
    if (!nextType) return onValidityChange(false);
    onValidityChange(buildPurchaseDestination({ type: nextType, value: v }, null).ok);
  }

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="destinationType" value={type} />
      <input type="hidden" name="destinationValue" value={value} />
      <h3 className="text-base font-semibold text-foreground">Calon pembeli diarahkan ke mana?</h3>
      <div className="grid grid-cols-1 gap-2">
        {OPTIONS.map(({ type: t, icon: Icon, hint }) => (
          <button
            key={t}
            type="button"
            aria-pressed={type === t}
            onClick={() => {
              setType(t);
              report(t, website, whatsapp);
            }}
            className={cn(
              "flex min-h-11 items-start gap-3 rounded-[var(--radius-md)] border px-4 py-3 text-left transition-colors",
              type === t ? "border-brand bg-brand-muted" : "border-border-strong hover:bg-surface-muted",
            )}
          >
            <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <span className="block text-sm font-medium text-foreground">{DESTINATION_LABELS[t]}</span>
              <span className="block text-xs text-muted-foreground">{hint}</span>
            </span>
          </button>
        ))}
      </div>

      {type === "WEBSITE" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="destination-website">Alamat website (wajib HTTPS)</Label>
          <Input
            id="destination-website"
            type="url"
            inputMode="url"
            placeholder="https://tokoanda.com/produk"
            value={website}
            onChange={(e) => {
              setWebsite(e.target.value);
              report("WEBSITE", e.target.value, whatsapp);
            }}
            className="h-11"
          />
        </div>
      ) : null}

      {type === "WHATSAPP" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="destination-whatsapp">Nomor WhatsApp penjual</Label>
          <Input
            id="destination-whatsapp"
            type="tel"
            inputMode="tel"
            placeholder="08123456789"
            value={whatsapp}
            onChange={(e) => {
              setWhatsapp(e.target.value);
              report("WHATSAPP", website, e.target.value);
            }}
            className="h-11"
          />
        </div>
      ) : null}

      {type === "NONE" ? (
        <p className="rounded-[var(--radius-md)] bg-warning-muted p-3 text-sm text-foreground" role="note">
          Tanpa tujuan pembelian, iklan berbayar tidak akan bisa diluncurkan. Anda bisa melengkapinya nanti.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
