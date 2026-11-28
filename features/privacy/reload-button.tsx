"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function ReloadButton() {
  const router = useRouter();
  return (
    <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => router.refresh()}>
      Muat ulang
    </Button>
  );
}
