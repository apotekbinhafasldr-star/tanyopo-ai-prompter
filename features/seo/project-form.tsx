"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSeoProjectAction, type SeoActionState } from "@/features/seo/actions";

const initialState: SeoActionState = { error: null };

export function SeoProjectForm() {
  const [state, formAction, pending] = useActionState(createSeoProjectAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="websiteUrl">URL Website</Label>
          <Input id="websiteUrl" name="websiteUrl" type="url" placeholder="https://usaha-anda.com" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="targetKeywords">Kata Kunci Target (opsional, pisahkan dengan koma)</Label>
          <Input id="targetKeywords" name="targetKeywords" placeholder="apotek dekat saya, obat batuk anak" />
        </div>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <div>
        <Button type="submit" size="sm" loading={pending}>
          Buat Project SEO
        </Button>
      </div>
    </form>
  );
}
