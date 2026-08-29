"use client";

import { useActionState } from "react";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { scheduleContentAction, type ContentActionState } from "@/features/content/actions";

const initialState: ContentActionState = { error: null };

export function ScheduleForm({ contentItemId, scheduledAt }: { contentItemId: string; scheduledAt: string | null }) {
  const boundAction = scheduleContentAction.bind(null, contentItemId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <CalendarDays className="size-3.5 text-muted-foreground" aria-hidden />
      <Input
        type="date"
        name="scheduledAt"
        defaultValue={scheduledAt ? scheduledAt.slice(0, 10) : ""}
        className="h-8 w-auto text-xs"
      />
      <Button type="submit" size="sm" variant="ghost" loading={pending}>
        {scheduledAt ? "Ubah" : "Jadwalkan"}
      </Button>
      {state.error ? (
        <span role="alert" className="text-xs text-danger">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
