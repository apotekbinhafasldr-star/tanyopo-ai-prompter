"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { growthPlatforms } from "@/schemas/growth";
import { logFollowerSnapshotAction, type GrowthActionState } from "@/features/growth/actions";

const initialState: GrowthActionState = { error: null };

const selectClass =
  "h-10 rounded-[var(--radius-md)] border border-border-strong bg-surface px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40";

export function FollowerSnapshotForm() {
  const [state, formAction, pending] = useActionState(logFollowerSnapshotAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="snapshot-platform">Platform</Label>
          <select id="snapshot-platform" name="platform" defaultValue="" required className={selectClass}>
            <option value="" disabled>
              Pilih platform
            </option>
            {growthPlatforms.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="followerCount">Jumlah Follower</Label>
          <Input id="followerCount" name="followerCount" type="number" min={0} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="recordedAt">Tanggal</Label>
          <Input id="recordedAt" name="recordedAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
        </div>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <div>
        <Button type="submit" size="sm" variant="secondary" loading={pending}>
          Catat Jumlah Follower
        </Button>
      </div>
    </form>
  );
}
