"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Package, Sparkles, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils/cn";
import { formatCurrency, productTypeLabel } from "@/lib/utils/format";
import { primaryGoals } from "@/schemas/onboarding";
import { channelOptions } from "@/schemas/campaign";
import {
  generateQuickCampaignDraftAction,
  type PromoteActionState,
} from "@/features/promote/actions";

interface ProductOption {
  id: string;
  name: string;
  product_type: string;
  price: number | null;
  currency: string;
}

const TOTAL_STEPS = 3;
const initialState: PromoteActionState = { error: null };

/**
 * Quick Promote — the simple, default entry point into Promote (product
 * spec: "Saya punya produk → saya mau jual → LINOE kerjakan pemasarannya").
 * Only 2 screens of input (product, then objective + budget); step 3 is
 * the existing campaign detail page (/campaigns/[id]) — reused as-is, not
 * rebuilt — which already shows everything the AI decided and carries the
 * Approval Center CTA. Channel/audience targeting live behind a collapsed
 * "Pengaturan Lanjutan" disclosure, never required — leaving them empty is
 * the intended default, not an incomplete form.
 */
export function QuickPromoteWizard({
  products,
  preselectedProductId,
}: {
  products: ProductOption[];
  preselectedProductId?: string;
}) {
  const [step, setStep] = useState(1);
  const [productId, setProductId] = useState(preselectedProductId ?? "");
  const [objective, setObjective] = useState("");
  const [dailyBudget, setDailyBudget] = useState("");
  const [totalBudget, setTotalBudget] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [channels, setChannels] = useState<string[]>([]);
  const [targetCountry, setTargetCountry] = useState("");
  const [targetRegion, setTargetRegion] = useState("");
  const [targetCity, setTargetCity] = useState("");
  const [audienceNotes, setAudienceNotes] = useState("");
  const [state, formAction, pending] = useActionState(generateQuickCampaignDraftAction, initialState);

  const hasBudget = Number(dailyBudget) > 0 || Number(totalBudget) > 0;
  const canAdvance = step === 1 ? !!productId : objective.length > 0 && hasBudget;

  function toggleChannel(value: string) {
    setChannels((prev) => (prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value]));
  }

  if (products.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="Tambahkan produk terlebih dahulu"
        description="Quick Promote butuh minimal satu produk untuk dibuatkan strategi dan campaign."
        action={
          <Button asChild size="lg">
            <Link href="/products/new">Tambah Produk</Link>
          </Button>
        }
      />
    );
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardContent className="p-5 sm:p-8">
        <div className="mb-5 flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">Langkah {step} dari {TOTAL_STEPS}</p>
          <div className="flex items-center gap-1.5" aria-hidden>
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <div key={i} className={cn("h-1.5 flex-1 rounded-full", i < step ? "bg-brand" : "bg-surface-muted")} />
            ))}
          </div>
        </div>

        <form action={formAction} className="flex flex-col gap-6">
          <input type="hidden" name="productId" value={productId} />
          <input type="hidden" name="objective" value={objective} />
          <input type="hidden" name="dailyBudget" value={dailyBudget} />
          <input type="hidden" name="totalBudget" value={totalBudget} />
          {channels.map((c) => (
            <input key={c} type="hidden" name="channels" value={c} />
          ))}
          <input type="hidden" name="targetCountry" value={targetCountry} />
          <input type="hidden" name="targetRegion" value={targetRegion} />
          <input type="hidden" name="targetCity" value={targetCity} />
          <input type="hidden" name="audienceNotes" value={audienceNotes} />

          {step === 1 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold text-foreground">Produk apa yang mau dijual?</h2>
              <div className="grid grid-cols-1 gap-2">
                {products.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setProductId(p.id)}
                    aria-pressed={productId === p.id}
                    className={cn(
                      "min-h-11 rounded-[var(--radius-md)] border px-4 py-3 text-left transition-colors",
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
              <Link href="/products/new" className="text-sm font-medium text-brand hover:underline">
                + Tambah produk baru
              </Link>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold text-foreground">Tujuan promosi ini apa?</h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {primaryGoals.map((g) => (
                    <button
                      key={g.value}
                      type="button"
                      onClick={() => setObjective(g.value)}
                      aria-pressed={objective === g.value}
                      className={cn(
                        "min-h-11 rounded-[var(--radius-md)] border px-4 py-3 text-left text-sm font-medium transition-colors",
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

              <div className="flex flex-col gap-3">
                <Label htmlFor="dailyBudget">Berapa budget promosi ini?</Label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Input
                      id="dailyBudget"
                      type="number"
                      min={0}
                      inputMode="numeric"
                      placeholder="Budget harian (IDR)"
                      value={dailyBudget}
                      onChange={(e) => setDailyBudget(e.target.value)}
                      className="h-11"
                    />
                    <p className="text-xs text-muted-foreground">Contoh: 50000 untuk Rp50.000/hari</p>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    placeholder="atau budget total (IDR)"
                    value={totalBudget}
                    onChange={(e) => setTotalBudget(e.target.value)}
                    className="h-11"
                  />
                </div>
              </div>

              <p className="rounded-[var(--radius-md)] bg-brand-muted p-3 text-sm text-brand">
                Biarkan LINOE AI memilih strategi terbaik — target audiens, channel, positioning, dan
                materi iklan akan dibuatkan otomatis.
              </p>

              <div className="rounded-[var(--radius-md)] border border-border">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((v) => !v)}
                  className="flex min-h-11 w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-foreground"
                  aria-expanded={advancedOpen}
                >
                  Pengaturan Lanjutan (opsional)
                  <ChevronDown className={cn("size-4 shrink-0 transition-transform", advancedOpen && "rotate-180")} aria-hidden />
                </button>
                {advancedOpen ? (
                  <div className="flex flex-col gap-4 border-t border-border p-4">
                    <div className="flex flex-col gap-2">
                      <Label>Channel (kosongkan agar AI yang pilih)</Label>
                      <div className="grid grid-cols-2 gap-2">
                        {channelOptions.map((c) => (
                          <button
                            key={c.value}
                            type="button"
                            onClick={() => toggleChannel(c.value)}
                            aria-pressed={channels.includes(c.value)}
                            className={cn(
                              "min-h-11 rounded-[var(--radius-md)] border px-3 py-2 text-left text-sm font-medium transition-colors",
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
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="qp-country">Negara</Label>
                        <Input id="qp-country" value={targetCountry} onChange={(e) => setTargetCountry(e.target.value)} className="h-11" />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="qp-region">Provinsi</Label>
                        <Input id="qp-region" value={targetRegion} onChange={(e) => setTargetRegion(e.target.value)} className="h-11" />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="qp-city">Kota</Label>
                        <Input id="qp-city" value={targetCity} onChange={(e) => setTargetCity(e.target.value)} className="h-11" />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="qp-audience">Catatan audiens</Label>
                      <Textarea
                        id="qp-audience"
                        value={audienceNotes}
                        onChange={(e) => setAudienceNotes(e.target.value)}
                        placeholder="Contoh: ibu-ibu usia 25-40 yang aktif belanja online"
                        rows={3}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {state.error ? (
            <p role="alert" className="text-sm text-danger">
              {state.error}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            {step > 1 ? (
              <Button type="button" variant="ghost" size="lg" onClick={() => setStep((s) => s - 1)}>
                <ArrowLeft />
                Kembali
              </Button>
            ) : (
              <span />
            )}

            {step < 2 ? (
              <Button type="button" size="lg" disabled={!canAdvance} onClick={() => setStep((s) => s + 1)}>
                Lanjut
                <ArrowRight />
              </Button>
            ) : (
              <Button type="submit" size="lg" disabled={!canAdvance} loading={pending}>
                <Sparkles />
                {pending ? "AI sedang menyusun strategi..." : "Buat Strategi dengan AI"}
              </Button>
            )}
          </div>
          {pending ? (
            <p className="text-center text-xs text-muted-foreground" role="status">
              Mohon tunggu, biasanya butuh beberapa detik.
            </p>
          ) : null}
        </form>

        {step === 1 ? (
          <p className="mt-6 text-center text-xs text-muted-foreground">
            Butuh kontrol lebih detail?{" "}
            <Link href="/promote?mode=advanced" className="font-medium text-brand hover:underline">
              Mode Lanjutan
            </Link>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
