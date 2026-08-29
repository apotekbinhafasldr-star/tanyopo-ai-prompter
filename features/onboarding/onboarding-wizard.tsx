"use client";

import { useActionState, useState } from "react";
import { Package, Radio, ArrowRight, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { businessCategories, primaryGoals } from "@/schemas/onboarding";
import {
  completeOnboardingAction,
  skipOnboardingAction,
  type OnboardingActionState,
} from "@/features/onboarding/actions";

const TOTAL_STEPS = 6;
const initialState: OnboardingActionState = { error: null };

function OptionGrid({
  options,
  value,
  onChange,
}: {
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={cn(
            "rounded-[var(--radius-md)] border px-4 py-3 text-left text-sm font-medium transition-colors",
            value === opt.value
              ? "border-brand bg-brand-muted text-brand"
              : "border-border-strong text-foreground hover:bg-surface-muted",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function OnboardingWizard() {
  const [step, setStep] = useState(1);
  const [brandName, setBrandName] = useState("");
  const [businessCategory, setBusinessCategory] = useState("");
  const [whatDoYouSell, setWhatDoYouSell] = useState("");
  const [primaryGoal, setPrimaryGoal] = useState("");
  const [state, formAction, pending] = useActionState(completeOnboardingAction, initialState);

  const canAdvanceFrom: Record<number, boolean> = {
    1: brandName.trim().length >= 2,
    2: businessCategory.length > 0,
    3: whatDoYouSell.trim().length >= 3,
    4: primaryGoal.length > 0,
    5: true,
    6: true,
  };

  return (
    <Card className="w-full max-w-lg">
      <CardContent className="p-8">
        <div className="mb-6 flex items-center gap-1.5" aria-hidden>
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full",
                i < step ? "bg-brand" : "bg-surface-muted",
              )}
            />
          ))}
        </div>

        <form action={formAction} className="flex flex-col gap-6">
          <input type="hidden" name="brandName" value={brandName} />
          <input type="hidden" name="businessCategory" value={businessCategory} />
          <input type="hidden" name="whatDoYouSell" value={whatDoYouSell} />
          <input type="hidden" name="primaryGoal" value={primaryGoal} />

          {step === 1 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold text-foreground">
                Siapa nama bisnis Anda?
              </h2>
              <p className="text-sm text-muted-foreground">
                Nama ini akan digunakan AI saat membuat konten dan campaign.
              </p>
              <Label htmlFor="brandNameInput" className="sr-only">
                Nama bisnis
              </Label>
              <Input
                id="brandNameInput"
                autoFocus
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="Contoh: Kopi Nusantara"
              />
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold text-foreground">Apa jenis bisnis Anda?</h2>
              <p className="text-sm text-muted-foreground">
                Pilih yang paling sesuai — Anda bisa mengubahnya nanti.
              </p>
              <OptionGrid
                options={businessCategories}
                value={businessCategory}
                onChange={setBusinessCategory}
              />
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold text-foreground">Apa yang Anda jual?</h2>
              <p className="text-sm text-muted-foreground">
                Ceritakan singkat produk atau jasa Anda. AI memakai ini untuk memahami bisnis Anda.
              </p>
              <Textarea
                autoFocus
                value={whatDoYouSell}
                onChange={(e) => setWhatDoYouSell(e.target.value)}
                placeholder="Contoh: Kopi kemasan siap seduh dari petani lokal, tersedia dalam 3 varian rasa."
                rows={4}
              />
            </div>
          )}

          {step === 4 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold text-foreground">
                Apa tujuan utama Anda?
              </h2>
              <p className="text-sm text-muted-foreground">
                AI akan menyesuaikan strategi berdasarkan tujuan ini.
              </p>
              <OptionGrid options={primaryGoals} value={primaryGoal} onChange={setPrimaryGoal} />
            </div>
          )}

          {step === 5 && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-brand-muted">
                <Package className="size-6 text-brand" aria-hidden />
              </div>
              <h2 className="text-lg font-semibold text-foreground">
                Tambahkan produk pertama Anda
              </h2>
              <p className="text-sm text-muted-foreground">
                Anda bisa menambahkan produk sekarang atau nanti dari halaman Products.
              </p>
            </div>
          )}

          {step === 6 && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-brand-muted">
                <Radio className="size-6 text-brand" aria-hidden />
              </div>
              <h2 className="text-lg font-semibold text-foreground">
                Hubungkan channel marketing
              </h2>
              <p className="text-sm text-muted-foreground">
                Sambungkan Facebook, Instagram, TikTok, atau X kapan saja dari halaman Connections.
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
              <Button
                type="button"
                disabled={!canAdvanceFrom[step]}
                onClick={() => setStep((s) => s + 1)}
              >
                Lanjut
                <ArrowRight />
              </Button>
            ) : (
              <Button type="submit" loading={pending}>
                Selesai, ke Dashboard
              </Button>
            )}
          </div>
        </form>

        {step >= 5 ? (
          <form action={skipOnboardingAction} className="mt-3 text-center">
            <button
              type="submit"
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Lewati, atur nanti
            </button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
