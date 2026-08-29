"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Package, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils/cn";
import { formatCurrency, productTypeLabel, channelLabel, goalLabel } from "@/lib/utils/format";
import { primaryGoals } from "@/schemas/onboarding";
import { channelOptions } from "@/schemas/campaign";
import {
  generateCampaignDraftAction,
  type PromoteActionState,
} from "@/features/promote/actions";

interface ProductOption {
  id: string;
  name: string;
  product_type: string;
  price: number | null;
  currency: string;
}

const TOTAL_STEPS = 6;
const initialState: PromoteActionState = { error: null };

export function PromoteWizard({
  products,
  preselectedProductId,
}: {
  products: ProductOption[];
  preselectedProductId?: string;
}) {
  const [step, setStep] = useState(1);
  const [productId, setProductId] = useState(preselectedProductId ?? "");
  const [objective, setObjective] = useState("");
  const [channels, setChannels] = useState<string[]>([]);
  const [targetCountry, setTargetCountry] = useState("Indonesia");
  const [targetRegion, setTargetRegion] = useState("");
  const [targetCity, setTargetCity] = useState("");
  const [audienceNotes, setAudienceNotes] = useState("");
  const [dailyBudget, setDailyBudget] = useState("");
  const [totalBudget, setTotalBudget] = useState("");
  const [durationDays, setDurationDays] = useState("");
  const [startDate, setStartDate] = useState("");
  const [state, formAction, pending] = useActionState(generateCampaignDraftAction, initialState);

  const selectedProduct = products.find((p) => p.id === productId);

  const canAdvanceFrom: Record<number, boolean> = {
    1: !!productId,
    2: objective.length > 0,
    3: channels.length > 0,
    4: true,
    5: true,
    6: true,
  };

  function toggleChannel(value: string) {
    setChannels((prev) => (prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value]));
  }

  if (products.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="Tambahkan produk terlebih dahulu"
        description="Promote Wizard butuh minimal satu produk untuk dibuatkan strategi dan campaign."
        action={
          <Button asChild size="sm">
            <Link href="/products/new">Tambah Produk</Link>
          </Button>
        }
      />
    );
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardContent className="p-8">
        <div className="mb-6 flex items-center gap-1.5" aria-hidden>
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div key={i} className={cn("h-1 flex-1 rounded-full", i < step ? "bg-brand" : "bg-surface-muted")} />
          ))}
        </div>

        <form action={formAction} className="flex flex-col gap-6">
          <input type="hidden" name="productId" value={productId} />
          <input type="hidden" name="objective" value={objective} />
          {channels.map((c) => (
            <input key={c} type="hidden" name="channels" value={c} />
          ))}
          <input type="hidden" name="targetCountry" value={targetCountry} />
          <input type="hidden" name="targetRegion" value={targetRegion} />
          <input type="hidden" name="targetCity" value={targetCity} />
          <input type="hidden" name="audienceNotes" value={audienceNotes} />
          <input type="hidden" name="dailyBudget" value={dailyBudget} />
          <input type="hidden" name="totalBudget" value={totalBudget} />
          <input type="hidden" name="durationDays" value={durationDays} />
          <input type="hidden" name="startDate" value={startDate} />

          {step === 1 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold text-foreground">Apa yang ingin Anda promosikan?</h2>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {products.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setProductId(p.id)}
                    aria-pressed={productId === p.id}
                    className={cn(
                      "rounded-[var(--radius-md)] border px-4 py-3 text-left transition-colors",
                      productId === p.id
                        ? "border-brand bg-brand-muted"
                        : "border-border-strong hover:bg-surface-muted",
                    )}
                  >
                    <p className="text-sm font-medium text-foreground">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {productTypeLabel(p.product_type)} · {formatCurrency(p.price, p.currency)}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold text-foreground">Apa tujuan campaign ini?</h2>
              <div className="grid grid-cols-2 gap-3">
                {primaryGoals.map((g) => (
                  <button
                    key={g.value}
                    type="button"
                    onClick={() => setObjective(g.value)}
                    aria-pressed={objective === g.value}
                    className={cn(
                      "rounded-[var(--radius-md)] border px-4 py-3 text-left text-sm font-medium transition-colors",
                      objective === g.value
                        ? "border-brand bg-brand-muted text-brand"
                        : "border-border-strong text-foreground hover:bg-surface-muted",
                    )}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold text-foreground">Di mana Anda ingin promosi?</h2>
              <p className="text-sm text-muted-foreground">
                Channel yang belum terhubung tetap bisa dipakai untuk membuat strategi &amp; draft konten —
                menghubungkan akun dilakukan terpisah di Connections.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {channelOptions.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => toggleChannel(c.value)}
                    aria-pressed={channels.includes(c.value)}
                    className={cn(
                      "rounded-[var(--radius-md)] border px-4 py-3 text-left text-sm font-medium transition-colors",
                      channels.includes(c.value)
                        ? "border-brand bg-brand-muted text-brand"
                        : "border-border-strong text-foreground hover:bg-surface-muted",
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold text-foreground">Siapa yang ingin Anda jangkau?</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="country">Negara</Label>
                  <Input id="country" value={targetCountry} onChange={(e) => setTargetCountry(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="region">Provinsi</Label>
                  <Input id="region" value={targetRegion} onChange={(e) => setTargetRegion(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="city">Kota</Label>
                  <Input id="city" value={targetCity} onChange={(e) => setTargetCity(e.target.value)} />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="audienceNotes">Catatan audiens (opsional)</Label>
                <Textarea
                  id="audienceNotes"
                  value={audienceNotes}
                  onChange={(e) => setAudienceNotes(e.target.value)}
                  placeholder="Contoh: ibu-ibu usia 25-40 yang aktif belanja online"
                  rows={3}
                />
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold text-foreground">Berapa uang maksimal yang boleh digunakan?</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="dailyBudget">Budget Harian (IDR)</Label>
                  <Input id="dailyBudget" type="number" min={0} value={dailyBudget} onChange={(e) => setDailyBudget(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="totalBudget">Budget Total (IDR)</Label>
                  <Input id="totalBudget" type="number" min={0} value={totalBudget} onChange={(e) => setTotalBudget(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="durationDays">Durasi (hari)</Label>
                  <Input id="durationDays" type="number" min={1} value={durationDays} onChange={(e) => setDurationDays(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="startDate">Tanggal Mulai</Label>
                  <Input id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {step === 6 && (
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold text-foreground">Siap membuat strategi dengan AI</h2>
              <div className="rounded-[var(--radius-md)] bg-surface-muted p-4 text-sm text-foreground">
                <p><strong>Produk:</strong> {selectedProduct?.name}</p>
                <p><strong>Tujuan:</strong> {goalLabel(objective)}</p>
                <p><strong>Channel:</strong> {channels.map(channelLabel).join(", ")}</p>
                {(targetCity || targetRegion) && (
                  <p><strong>Target:</strong> {[targetCity, targetRegion, targetCountry].filter(Boolean).join(", ")}</p>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                AI akan membuat positioning, headline, teks iklan, dan alokasi budget. Anda tetap bisa meninjau dan
                menyimpannya sebagai draft sebelum meluncurkan apa pun.
              </p>
            </div>
          )}

          {state.error ? (
            <p role="alert" className="text-sm text-danger">
              {state.error}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            {step > 1 ? (
              <Button type="button" variant="ghost" onClick={() => setStep((s) => s - 1)}>
                <ArrowLeft />
                Kembali
              </Button>
            ) : (
              <span />
            )}

            {step < TOTAL_STEPS ? (
              <Button type="button" disabled={!canAdvanceFrom[step]} onClick={() => setStep((s) => s + 1)}>
                Lanjut
                <ArrowRight />
              </Button>
            ) : (
              <Button type="submit" loading={pending}>
                <Sparkles />
                Buat Campaign dengan AI
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
