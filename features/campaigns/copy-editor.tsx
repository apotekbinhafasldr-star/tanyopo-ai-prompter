"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CampaignActionState } from "@/features/campaigns/actions";

const initialState: CampaignActionState = { error: null };

export function CampaignCopyEditor({
  action,
  headline,
  primaryText,
  cta,
}: {
  action: (prevState: CampaignActionState, formData: FormData) => Promise<CampaignActionState>;
  headline: string;
  primaryText: string;
  cta: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="headline">Headline</Label>
        <Input id="headline" name="headline" defaultValue={headline} maxLength={120} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="primaryText">Teks Utama</Label>
        <Textarea id="primaryText" name="primaryText" defaultValue={primaryText} rows={4} maxLength={600} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cta">Call to Action</Label>
        <Input id="cta" name="cta" defaultValue={cta} maxLength={40} />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      <div>
        <Button type="submit" size="sm" loading={pending}>
          Simpan Perubahan
        </Button>
      </div>
    </form>
  );
}
